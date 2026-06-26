import { alignSyncMap } from '../src/lib/alignSyncMap.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

const tok = (text: string, page: number, yRatio: number, xRatio: number) => ({ text, page, xRatio, yRatio })
const word = (text: string, start: number) => ({ text, start, end: start + 0.3, confidence: 0.9 })

// "Fly me to the moon" — syllables on one row of page 1, sung in order.
const lyrics = [
  tok('Fly', 1, 0.20, 0.10),
  tok('me', 1, 0.20, 0.20),
  tok('to', 1, 0.20, 0.30),
  tok('the', 1, 0.20, 0.40),
  tok('moon', 1, 0.20, 0.50),
  // next system, page 1 lower
  tok('and', 1, 0.45, 0.10),
  tok('let', 1, 0.45, 0.20),
  tok('me', 1, 0.45, 0.30),
  tok('play', 1, 0.45, 0.40),
  // page 2
  tok('a', 2, 0.20, 0.10),
  tok('mong', 2, 0.20, 0.16),
  tok('the', 2, 0.20, 0.30),
  tok('stars', 2, 0.20, 0.40),
]
const words = [
  word('fly', 0.5), word('me', 1.0), word('to', 1.5), word('the', 2.0), word('moon', 2.5),
  word('and', 3.0), word('let', 3.5), word('me', 4.0), word('play', 4.5),
  word('among', 6.0), word('the', 6.5), word('stars', 7.0),
]

{
  const anchors = alignSyncMap(lyrics, words)
  console.log('\nbasic phrase:', anchors.map(a => `${a.text}@${a.time}(p${a.page},${a.yWithinPageRatio})`).join(' '))
  check('produced anchors', anchors.length >= 6)
  check('times strictly increasing', anchors.every((a, i) => i === 0 || a.time > anchors[i-1].time))
  check('positions monotonic (page,y never decrease)', anchors.every((a, i) => i === 0 ||
    a.page > anchors[i-1].page || (a.page === anchors[i-1].page && a.yWithinPageRatio >= anchors[i-1].yWithinPageRatio)))
  check('matched "moon"', anchors.some(a => a.text.toLowerCase() === 'moon'))
  check('substring: "mong" or "a" maps into "among" region', anchors.some(a => a.page === 2))
  check('anchor yRatio passes through', anchors.every(a => a.yWithinPageRatio >= 0 && a.yWithinPageRatio <= 1))
}

// Monotonicity pruning: inject a spurious early-time match at a late position.
{
  const noisy = [...lyrics, tok('moon', 1, 0.95, 0.9)] // a 'moon' near bottom of page 1
  const anchors = alignSyncMap(noisy, words)
  const backward = anchors.some((a, i) => i > 0 &&
    (a.page < anchors[i-1].page || (a.page === anchors[i-1].page && a.yWithinPageRatio < anchors[i-1].yWithinPageRatio)))
  check('no backward jumps despite duplicate lyric', !backward)
}

// Echo/reprise: the same phrase prints on two systems; a single sung pass should
// resolve to ONE smooth trajectory, not zig-zag between the copies. With the words
// arriving steadily, the smoother chain is the first copy (page 1), then the tag
// echo (page 2) only if sung again.
{
  const l = [
    // copy A — page 1, lower system
    tok('some', 1, 0.6, 0.1), tok('thing', 1, 0.6, 0.2), tok('good', 1, 0.6, 0.3),
    // copy B — page 2, upper system (the echo)
    tok('some', 2, 0.2, 0.1), tok('thing', 2, 0.2, 0.2), tok('good', 2, 0.2, 0.3),
  ]
  const w = [word('something', 1.0), word('good', 1.5)]
  const anchors = alignSyncMap(l, w)
  check('single sung pass stays on one system (page 1)', anchors.length >= 1 && anchors.every(a => a.page === 1))
}

// Empty inputs
check('empty lyrics -> []', alignSyncMap([], words).length === 0)
check('empty words -> []', alignSyncMap(lyrics, []).length === 0)

// Latin-ish / accent + case robustness
{
  const l = [tok('Glo', 1, 0.2, 0.1), tok('ri', 1, 0.2, 0.2), tok('a', 1, 0.2, 0.3)]
  const w = [word('gloria', 1.0)]
  const anchors = alignSyncMap(l, w)
  check('syllables of "gloria" yield an anchor', anchors.length >= 1 && anchors[0].time === 1.0)
  check('reconstructs the whole word "gloria"', anchors[0].text.toLowerCase() === 'gloria')
}

// Regression: substring inflation. "corner" must reconstruct from cor+ner and
// must NOT land on the bare "or" that sits in the same row (old bug: "or" scored 0.9).
{
  const l = [
    tok('the', 8, 0.5, 0.1), tok('cor', 8, 0.5, 0.2), tok('ner', 8, 0.5, 0.3), tok('or', 8, 0.5, 0.4),
  ]
  const w = [word('the', 1.0), word('corner', 2.0)]
  const anchors = alignSyncMap(l, w)
  check('reconstructs "corner" from cor+ner', anchors.some(a => a.text.toLowerCase() === 'corner'))
  check('does NOT anchor "corner" onto bare "or"', !anchors.some(a => a.heard === 'corner' && a.text.toLowerCase() === 'or'))
}

// Regression: repeat/reprise. The sung "beach" must bind the exact "beach" token
// (page 13), not the "be" of "Maybe" on the next page (old bug: be ⊂ beach = 0.9).
{
  const l = [
    tok('on', 13, 0.79, 0.1), tok('a', 13, 0.79, 0.2), tok('beach', 13, 0.79, 0.3),
    tok('May', 13, 0.79, 0.4), tok('be', 13, 0.79, 0.5),
    tok('May', 14, 0.17, 0.1), tok('be', 14, 0.17, 0.2),
  ]
  const w = [word('on', 1.0), word('beach', 2.0), word('maybe', 3.0)]
  const anchors = alignSyncMap(l, w)
  const beachAnchor = anchors.find(a => a.heard === 'beach')
  check('"beach" binds the real beach token, not "be"', !!beachAnchor && beachAnchor.page === 13 && beachAnchor.text.toLowerCase() === 'beach')
}

// Repeated-lyric trap (the "it's" bug): a sung word prints twice — once far up an
// earlier page, once right before the next correctly-aligned word. Matching the heard
// "its"@33.4 to the FAR/top instance would imply a page-sized jump 0.6 s before
// "only"@34.0 — a leap no singer makes. The hard plausibility limit forbids that edge,
// so "its" must NOT land on the top instance; "only"/"just" anchor on the real page.
{
  const l = [
    tok('hello', 1, 0.20, 0.10),
    tok('world', 2, 0.20, 0.10),
    tok('its', 3, 0.15, 0.50), // top instance, far up — the tempting wrong match
    // bottom cluster, contiguous, on the real page
    tok('its', 4, 0.85, 0.30), tok('only', 4, 0.85, 0.40), tok('just', 4, 0.85, 0.50),
  ]
  const w = [word('hello', 10.0), word('world', 20.0), word('its', 33.4), word('only', 34.0), word('just', 34.3)]
  const anchors = alignSyncMap(l, w)
  console.log('\nrepeated-lyric trap:', anchors.map(a => `${a.heard}@${a.time}→p${a.page}`).join(' '))
  const itsOnTop = anchors.some(a => a.heard === 'its' && a.page === 3)
  check('sung "its" does NOT bind the impossible far/top instance (p3)', !itsOnTop)
  check('"only" anchors on the real page (p4)', anchors.some(a => a.heard === 'only' && a.page === 4))
  check('"just" anchors on the real page (p4)', anchors.some(a => a.heard === 'just' && a.page === 4))
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
