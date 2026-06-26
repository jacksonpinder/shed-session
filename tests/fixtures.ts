import { existsSync, readdirSync } from 'node:fs'

// Fixture PDFs live in public/ and (the larger corpus) public/PDFs/. Resolve by
// name across both so tests don't break when files are reorganised.
const DIRS = ['public', 'public/PDFs']

export const fixturePath = (file: string): string => {
  for (const dir of DIRS) if (existsSync(`${dir}/${file}`)) return `${dir}/${file}`
  return `public/${file}` // not found → return a path that will error visibly
}

export const hasFixture = (file: string): boolean => DIRS.some((d) => existsSync(`${d}/${file}`))

/** Every fixture PDF across both dirs, as full paths, sorted by base name. */
export const allFixturePdfs = (): string[] => {
  const out: string[] = []
  for (const dir of DIRS) {
    try {
      for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith('.pdf')) out.push(`${dir}/${f}`)
    } catch {
      /* dir absent */
    }
  }
  return out.sort((a, b) => a.split('/').pop()!.localeCompare(b.split('/').pop()!))
}
