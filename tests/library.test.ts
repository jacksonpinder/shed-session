// Storage-layer tests for src/lib/library.ts. Runs under Node 22 type-stripping
// with fake-indexeddb providing the IndexedDB global.
import 'fake-indexeddb/auto'
import {
  createSong,
  getSong,
  updateSong,
  deleteSong,
  duplicateSong,
  listSongs,
  createTrack,
  getTrack,
  listTracks,
  updateTrack,
  deleteTrack,
  putBlob,
  getBlob,
  deleteBlob,
  DEFAULT_SETTINGS,
} from '../src/lib/library.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}
const blob = (s: string) => new Blob([s], { type: 'application/octet-stream' })
const textOf = async (b: Blob | null) => (b ? await b.text() : null)

const run = async () => {
  // --- blobs ---
  {
    const key = await putBlob(blob('hello'))
    check('putBlob returns a key', typeof key === 'string' && key.length > 0)
    check('getBlob round-trips content', (await textOf(await getBlob(key))) === 'hello')
    await deleteBlob(key)
    check('deleteBlob removes the blob', (await getBlob(key)) === null)
    const custom = await putBlob(blob('x'), 'my-key')
    check('putBlob honors an explicit key', custom === 'my-key')
  }

  // --- song create / defaults / get ---
  const song = await createSong({ title: 'Test Song' })
  {
    check('createSong assigns an id', !!song.id)
    check('new song starts with empty loops', Array.isArray(song.loops) && song.loops.length === 0)
    check('new song starts with no tracks', song.trackIds.length === 0)
    check('settings default applied', JSON.stringify(song.settings) === JSON.stringify(DEFAULT_SETTINGS))
    const fetched = await getSong(song.id)
    check('getSong round-trips', fetched?.title === 'Test Song')
    check('getSong(missing) is null', (await getSong('nope')) === null)
  }

  // --- updateSong merges + bumps updatedAt ---
  {
    const before = (await getSong(song.id))!.updatedAt
    await new Promise((r) => setTimeout(r, 2))
    const updated = await updateSong(song.id, { title: 'Renamed' })
    check('updateSong applies patch', updated.title === 'Renamed')
    check('updateSong preserves untouched fields', updated.trackIds.length === 0)
    check('updateSong bumps updatedAt', updated.updatedAt > before)
  }

  // --- createTrack appends + auto-selects first ---
  const t1 = await createTrack({ songId: song.id, name: 'Full mix', audioBlobKey: await putBlob(blob('a1')) })
  {
    check('createTrack defaults leadInOffset to 0', t1.leadInOffset === 0)
    check('createTrack status idle', t1.analysis.status === 'idle')
    const s = (await getSong(song.id))!
    check('song.trackIds includes new track', s.trackIds.includes(t1.id))
    check('first track auto-selected', s.selectedTrackId === t1.id)
    check('first track set as reference', s.referenceTrackId === t1.id)
  }

  // --- second track does not steal selection ---
  const t2 = await createTrack({ songId: song.id, name: 'Lead predom', audioBlobKey: await putBlob(blob('a2')), leadInOffset: 3.5 })
  {
    const s = (await getSong(song.id))!
    check('second track appended', s.trackIds.length === 2)
    check('selection stays on first track', s.selectedTrackId === t1.id)
    check('explicit leadInOffset honored', t2.leadInOffset === 3.5)
    const tracks = await listTracks(song.id)
    check('listTracks returns both', tracks.length === 2)
    check('listTracks scoped to song', tracks.every((t) => t.songId === song.id))
  }

  // --- updateTrack patch ---
  {
    const patched = await updateTrack(t2.id, { analysis: { status: 'done' }, leadInOffset: 4 })
    check('updateTrack applies patch', patched.analysis.status === 'done' && patched.leadInOffset === 4)
    check('updateTrack keeps songId', patched.songId === song.id)
    check('updateTrack persists', (await getTrack(t2.id))?.leadInOffset === 4)
  }

  // --- deleteTrack unlinks, reselects, deletes audio blob ---
  {
    const audioKey = t1.audioBlobKey
    await deleteTrack(t1.id)
    check('deleted track is gone', (await getTrack(t1.id)) === null)
    check('deleted track audio blob removed', (await getBlob(audioKey)) === null)
    const s = (await getSong(song.id))!
    check('trackIds unlinked', !s.trackIds.includes(t1.id) && s.trackIds.length === 1)
    check('selection moves to remaining track', s.selectedTrackId === t2.id)
    check('reference moves to remaining track', s.referenceTrackId === t2.id)
  }

  // --- deleteSong cascades tracks + pdf + audio + take blobs ---
  {
    const pdfKey = await putBlob(blob('pdf-bytes'))
    const cascade = await createSong({ title: 'Cascade', pdfBlobKey: pdfKey })
    const audioKey = await putBlob(blob('audio'))
    const ct = await createTrack({ songId: cascade.id, name: 'mix', audioBlobKey: audioKey })
    const takeKey = await putBlob(blob('take'))
    await updateTrack(ct.id, { takeMeta: { id: takeKey, offsetSec: 0, duration: 1, volume: 0.9 } })

    await deleteSong(cascade.id)
    check('song removed', (await getSong(cascade.id)) === null)
    check('cascade: track removed', (await getTrack(ct.id)) === null)
    check('cascade: pdf blob removed', (await getBlob(pdfKey)) === null)
    check('cascade: audio blob removed', (await getBlob(audioKey)) === null)
    check('cascade: take blob removed', (await getBlob(takeKey)) === null)
  }

  // --- duplicateSong deep-clones song + tracks with fresh blobs ---
  {
    const pdfKey = await putBlob(blob('orig-pdf'))
    const orig = await createSong({ title: 'Dup Me', pdfBlobKey: pdfKey })
    await updateSong(orig.id, { loops: [{ id: 'l1', name: 'A', start: 1, end: 2, color: '#000', loopOn: true }] })
    const ot = await createTrack({ songId: orig.id, name: 'mix', audioBlobKey: await putBlob(blob('orig-audio')) })
    await updateTrack(ot.id, { transcription: { words: [], language: 'en', duration: 10, sourceHash: 'h' } })

    const dup = await duplicateSong(orig.id)
    check('duplicate returns a new song', !!dup && dup.id !== orig.id)
    check('duplicate title suffixed', dup?.title === 'Dup Me (copy)')
    check('duplicate copies loops', dup?.loops.length === 1 && dup?.loops[0].name === 'A')
    const dupTracks = await listTracks(dup!.id)
    check('duplicate copies tracks', dupTracks.length === 1 && dupTracks[0].name === 'mix')
    check('duplicate carries analysis over', !!dupTracks[0].transcription)
    check('duplicate track uses a NEW audio blob key', dupTracks[0].audioBlobKey !== ot.audioBlobKey)
    check('duplicate pdf is a NEW blob key', dup?.pdfBlobKey !== orig.pdfBlobKey && !!dup?.pdfBlobKey)

    // Deleting the original must not remove the duplicate's blobs.
    await deleteSong(orig.id)
    check('duplicate audio blob survives original delete', (await getBlob(dupTracks[0].audioBlobKey)) !== null)
    check('duplicate pdf blob survives original delete', (await getBlob(dup!.pdfBlobKey!)) !== null)
  }

  // --- listSongs sorted by updatedAt desc ---
  {
    const older = await createSong({ title: 'Older' })
    await new Promise((r) => setTimeout(r, 2))
    const newer = await createSong({ title: 'Newer' })
    const ids = (await listSongs()).map((s) => s.id)
    check('listSongs sorted newest-first', ids.indexOf(newer.id) < ids.indexOf(older.id))
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
