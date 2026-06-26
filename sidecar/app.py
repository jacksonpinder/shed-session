"""
Whisper sidecar for Score Sync.

POST /transcribe  (multipart file=<audio>)  ->  word-level timestamps.

Uses WhisperX (forced alignment for tight word timings on *sung* audio) on the
faster-whisper backend. Results are cached on disk by audio hash, so re-opening
the same file is instant. Runs locally in dev; deploy separately in prod.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8123
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import threading

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
CACHE_DIR = os.environ.get("WHISPER_CACHE", os.path.join(tempfile.gettempdir(), "score-sync-cache"))
os.makedirs(CACHE_DIR, exist_ok=True)

app = FastAPI(title="Score Sync — Whisper sidecar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only; restrict in production
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Lazy singletons — loading the model is slow, so do it once on first request.
# The lock guards against two concurrent first-requests both loading the model.
_state: dict = {"model": None, "device": None, "align": {}}
_model_lock = threading.Lock()
_align_lock = threading.Lock()


def _finite(value, default: float = 0.0) -> float:
    """Coerce NaN/Inf to a default. JSON has no NaN literal — leaving one in the
    response makes it invalid JSON that the browser's response.json() rejects."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _load_model():
    if _state["model"] is not None:
        return
    with _model_lock:
        if _state["model"] is not None:  # re-check inside the lock
            return
        import torch  # noqa: WPS433 (imported lazily so the server starts fast)
        import whisperx

        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        _state["device"] = device
        _state["model"] = whisperx.load_model(MODEL_SIZE, device, compute_type=compute_type)


def _align_model(language: str):
    import whisperx

    cached = _state["align"].get(language)
    if cached is not None:
        return cached
    with _align_lock:
        cached = _state["align"].get(language)  # re-check inside the lock
        if cached is None:
            cached = whisperx.load_align_model(language_code=language, device=_state["device"])
            _state["align"][language] = cached
    return cached  # (model, metadata)


def _clarity(env, sr: int, hop: int = 512) -> float:
    """Pulse clarity 0..1 of an onset envelope: the tallest normalized
    autocorrelation peak in the 40–240 BPM lag range. A steady groove peaks
    sharply (→1); rubato/free singing stays flat (→0)."""
    import numpy as np
    import librosa

    if len(env) < 8:
        return 0.0
    env = env - env.mean()
    ac = librosa.autocorrelate(env)
    if ac[0] <= 0:
        return 0.0
    ac = ac / ac[0]
    fps = sr / hop
    min_lag = max(1, int(fps * 60.0 / 240.0))  # fastest tempo → smallest lag
    max_lag = min(len(ac) - 1, int(fps * 60.0 / 40.0))  # slowest → largest lag
    if max_lag <= min_lag:
        return 0.0
    return float(np.clip(np.max(ac[min_lag : max_lag + 1]), 0.0, 1.0))


def _analyze_beats(audio, sr: int = 16000) -> dict | None:
    """Tempo, beat grid, and pulse clarity (global + in ~8 s windows, so a rubato
    intro that hops into tempo is visible as a clarity curve). Best-effort — any
    failure just omits the beat block rather than breaking transcription."""
    try:
        import numpy as np
        import librosa

        hop = 512
        env = librosa.onset.onset_strength(y=audio, sr=sr, hop_length=hop)
        tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop)
        beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
        fps = sr / hop
        win = int(fps * 8)
        windows = []
        for start in range(0, len(env), win):
            seg = env[start : start + win]
            if len(seg) < win // 2:
                break
            windows.append({"t": round(start / fps, 2), "clarity": round(_clarity(seg, sr, hop), 3)})
        return {
            # round(NaN) is still NaN — sanitize tempo, which beat_track can return
            # NaN/0 for on silent or very short audio.
            "tempo": round(_finite(np.atleast_1d(tempo)[0]), 2),
            "beatTimes": [round(_finite(t), 3) for t in beat_times],
            "pulseClarity": round(_finite(_clarity(env, sr, hop)), 3),
            "clarityWindows": windows,
        }
    except Exception:
        return None


def _transcribe(path: str) -> dict:
    import whisperx

    _load_model()
    audio = whisperx.load_audio(path)
    result = _state["model"].transcribe(audio, batch_size=16)
    language = result.get("language", "en")

    words = []
    try:
        align_model, metadata = _align_model(language)
        aligned = whisperx.align(result["segments"], align_model, metadata, audio, _state["device"])
        for w in aligned.get("word_segments", []):
            if w.get("start") is None or w.get("end") is None:
                continue
            text = str(w.get("word", "")).strip()
            if not text:
                continue
            words.append(
                {
                    "text": text,
                    "start": round(_finite(w["start"]), 3),
                    "end": round(_finite(w["end"]), 3),
                    "confidence": round(_finite(w.get("score", 0.0)), 3),
                }
            )
    except Exception:
        # Alignment can fail for unsupported languages — fall back to segment times.
        for seg in result.get("segments", []):
            for token in str(seg.get("text", "")).split():
                words.append({"text": token, "start": round(_finite(seg.get("start")), 3),
                              "end": round(_finite(seg.get("end")), 3), "confidence": 0.0})

    duration = _finite(len(audio)) / 16000.0
    out = {"words": words, "language": language, "duration": round(duration, 3)}
    beat = _analyze_beats(audio, 16000)
    if beat is not None:
        out["beat"] = beat
    return out


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL_SIZE, "device": _state["device"]}


def _read_cache(cache_path: str):
    """Return the cached result, or None if absent/corrupt. A truncated cache file
    (e.g. the process was killed mid-write) is deleted so it's recomputed instead
    of failing every future request."""
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        try:
            os.unlink(cache_path)
        except OSError:
            pass
        return None


def _write_cache(cache_path: str, result: dict) -> None:
    """Write atomically (temp file + replace) so a crash can't leave a partial,
    corrupt cache. allow_nan=False guarantees we never emit invalid JSON."""
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(result, fh, allow_nan=False)
        os.replace(tmp, cache_path)
    except (OSError, ValueError):
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.post("/transcribe")
async def transcribe(file: UploadFile) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    source_hash = hashlib.sha256(data).hexdigest()

    cache_path = os.path.join(CACHE_DIR, f"{source_hash}.json")
    cached = _read_cache(cache_path)
    if cached is not None:
        return cached

    suffix = os.path.splitext(file.filename or "")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        # Offload the blocking model work to a thread so /health and concurrent
        # requests stay responsive during a (possibly minutes-long) transcription.
        result = await run_in_threadpool(_transcribe, tmp_path)
    except Exception as exc:  # surface a clean 500 instead of an opaque crash
        raise HTTPException(status_code=500, detail=f"transcription failed: {exc}") from exc
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    result["sourceHash"] = source_hash
    _write_cache(cache_path, result)
    return result
