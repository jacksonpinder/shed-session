# Whisper sidecar

Small FastAPI service that turns an audio file into word-level timestamps for
Score Sync. Uses [WhisperX](https://github.com/m-bain/whisperX) (forced alignment
for tight timings on sung audio) on the faster-whisper backend, cached by audio
hash.

## Run (dev)

```bash
cd sidecar
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8123
```

The web app talks to it at `http://localhost:8123` (override with
`VITE_WHISPER_URL`, see `src/lib/transcribe.ts`).

## API

- `GET /health` → `{ ok, model, device }`
- `POST /transcribe` (multipart `file=<audio>`) →
  ```json
  {
    "words": [{ "text": "fly", "start": 0.42, "end": 0.71, "confidence": 0.98 }],
    "language": "en",
    "duration": 184.2,
    "sourceHash": "<sha256>"
  }
  ```

## Config (env)

- `WHISPER_MODEL` — model size (default `small`; `base`/`medium`/`large-v3`).
- `WHISPER_CACHE` — cache dir (default OS temp `/score-sync-cache`).

## Notes

- First request is slow (model load); subsequent ones reuse the loaded model,
  and identical audio is served from cache instantly.
- The first run downloads model weights.
- For production, restrict CORS in `app.py` and run behind a real ASGI server.
