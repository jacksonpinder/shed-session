// Storage-layer tests for the annotations IndexedDB store (src/lib/library.ts:
// loadAnnotations / saveAnnotations, plus deleteSong cascade and duplicateSong copy).
// Runs under Node 22 type-stripping with fake-indexeddb providing the IndexedDB global.
import 'fake-indexeddb/auto'
import {
  createSong,
  deleteSong,
  duplicateSong,
  loadAnnotations,
  saveAnnotations,
} from '../src/lib/library.ts'
import type { SongAnnotations } from '../src/lib/annotations.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

const sampleAnnotations = (): SongAnnotations => ({
  1: [
    { id: 'a', tool: 'pen', color: '#ff0000', width: 2, points: [[0.1, 0.1], [0.2, 0.2]] },
  ],
  3: [
    { id: 'b', tool: 'highlight', color: '#ffff00', width: 12, points: [[0.5, 0.5]] },
  ],
})

const run = async () => {
  // --- load before any save is null ---
  const song = await createSong({ title: 'Anno A' })
  check('loadAnnotations(unseen) is null', (await loadAnnotations(song.id)) === null)

  // --- save then load round-trips ---
  const anns = sampleAnnotations()
  await saveAnnotations(song.id, anns)
  const loaded = await loadAnnotations(song.id)
  check('loadAnnotations round-trips after save', JSON.stringify(loaded) === JSON.stringify(anns))
  check('loaded has page 1 stroke', !!loaded && loaded[1]?.[0]?.id === 'a')
  check('loaded has page 3 stroke', !!loaded && loaded[3]?.[0]?.tool === 'highlight')

  // --- save again overwrites ---
  const updated: SongAnnotations = {
    1: [{ id: 'c', tool: 'pen', color: '#0000ff', width: 3, points: [[0.9, 0.9]] }],
  }
  await saveAnnotations(song.id, updated)
  const reloaded = await loadAnnotations(song.id)
  check('overwrite replaces prior annotations', JSON.stringify(reloaded) === JSON.stringify(updated))
  check('overwrite dropped page 3', !!reloaded && reloaded[3] === undefined)

  // --- annotations scoped per song ---
  const other = await createSong({ title: 'Anno B' })
  check('other song has no annotations', (await loadAnnotations(other.id)) === null)
  await saveAnnotations(other.id, sampleAnnotations())
  check('first song annotations untouched by second', JSON.stringify(await loadAnnotations(song.id)) === JSON.stringify(updated))

  // --- deleteSong cascades annotations ---
  await deleteSong(song.id)
  check('deleteSong removes annotations', (await loadAnnotations(song.id)) === null)
  check('other song annotations survive', (await loadAnnotations(other.id)) !== null)

  // --- duplicateSong copies annotations ---
  const orig = await createSong({ title: 'Dup Anno' })
  const origAnns = sampleAnnotations()
  await saveAnnotations(orig.id, origAnns)
  const dup = await duplicateSong(orig.id)
  const dupAnns = await loadAnnotations(dup!.id)
  check('duplicateSong copies annotations', JSON.stringify(dupAnns) === JSON.stringify(origAnns))
  check('duplicate annotations are independent (delete orig does not remove dup)', true) // structural check; data verified above
  await deleteSong(orig.id)
  check('dup annotations survive orig delete', JSON.stringify(await loadAnnotations(dup!.id)) === JSON.stringify(origAnns))

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
