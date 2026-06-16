export type Track = {
  id: string
  name: string
  part: string | null
  variant: 'loud' | 'missing' | null
}

export type SongMeta = {
  title: string
  tracks: Track[]
}

export const SONG_META: SongMeta = {
  title: 'Monster Dance Medley',
  tracks: [
    { id: 'full-mix',   name: 'Full Mix',   part: null,    variant: null   },
    { id: 'loud-tenor', name: 'Loud Tenor', part: 'Tenor', variant: 'loud' },
    { id: 'loud-lead',  name: 'Loud Lead',  part: 'Lead',  variant: 'loud' },
    { id: 'loud-bari',  name: 'Loud Bari',  part: 'Bari',  variant: 'loud' },
    { id: 'loud-bass',  name: 'Loud Bass',  part: 'Bass',  variant: 'loud' },
  ],
}
