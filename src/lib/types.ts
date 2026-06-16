export type SheetPosition = {
  page: number
  yWithinPagePx?: number
  yWithinPageRatio?: number
  scrollTop?: number
}

export type SavedLoop = {
  id: string
  name: string
  start: number
  end: number
  color: string
  loopOn: boolean
  scrollOnRepeat?: boolean
  sheetLink?: SheetPosition
  sheetLinkDraft?: SheetPosition  // auto-captured on loop creation, unconfirmed by user
}
