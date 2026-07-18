import type { TerminalAccessoryKey } from './terminal-accessory-keys'

export const TERMINAL_ACCESSORY_PAGE_ROWS = 2
export const TERMINAL_ACCESSORY_PAGE_COLUMNS = 7
export const TERMINAL_ACCESSORY_PAGE_SIZE =
  TERMINAL_ACCESSORY_PAGE_ROWS * TERMINAL_ACCESSORY_PAGE_COLUMNS

export type TerminalAccessoryPageSlot =
  | { type: 'paste'; id: 'paste' }
  | { type: 'key'; id: string; key: TerminalAccessoryKey }
  | null

export type TerminalAccessoryPage = TerminalAccessoryPageSlot[]

const PRIMARY_PAGE_SLOT_IDS = [
  'escape',
  'paste',
  'shiftTab',
  'home',
  'arrowUp',
  'end',
  'backspace',
  'tab',
  'space',
  'delete',
  'arrowLeft',
  'arrowDown',
  'arrowRight',
  'enter'
] as const

const SECONDARY_PAGE_SLOT_IDS = [
  'ctrlC',
  'ctrlD',
  'ctrlL',
  'ctrlZ',
  'ctrlR',
  null,
  null,
  'ctrlA',
  'ctrlE',
  'ctrlW',
  'ctrlU',
  null,
  null,
  null
] as const

export function buildTerminalAccessoryPages(
  keys: readonly TerminalAccessoryKey[]
): TerminalAccessoryPage[] {
  const keysById = new Map(keys.map((key) => [key.id, key]))
  const primaryIds = new Set<string>(PRIMARY_PAGE_SLOT_IDS)
  const secondaryIds = new Set<string>()
  for (const id of SECONDARY_PAGE_SLOT_IDS) {
    if (id !== null) {
      secondaryIds.add(id)
    }
  }
  const primaryPage = PRIMARY_PAGE_SLOT_IDS.map<TerminalAccessoryPageSlot>((id) => {
    if (id === 'paste') {
      return { type: 'paste', id }
    }
    const key = keysById.get(id)
    return key ? { type: 'key', id, key } : null
  })
  const secondaryPage = SECONDARY_PAGE_SLOT_IDS.map<TerminalAccessoryPageSlot>((id) => {
    if (id === null) {
      return null
    }
    const key = keysById.get(id)
    return key ? { type: 'key', id, key } : null
  })
  const extraSlots = keys
    .filter((key) => !primaryIds.has(key.id) && !secondaryIds.has(key.id))
    .map<TerminalAccessoryPageSlot>((key) => ({ type: 'key', id: key.id, key }))
  const secondaryExtraIndexes = SECONDARY_PAGE_SLOT_IDS.flatMap((id, index) =>
    id === null ? [index] : []
  )

  for (const index of secondaryExtraIndexes) {
    secondaryPage[index] = extraSlots.shift() ?? null
  }

  const pages: TerminalAccessoryPage[] = [primaryPage, secondaryPage]

  for (let offset = 0; offset < extraSlots.length; offset += TERMINAL_ACCESSORY_PAGE_SIZE) {
    const page = extraSlots.slice(offset, offset + TERMINAL_ACCESSORY_PAGE_SIZE)
    while (page.length < TERMINAL_ACCESSORY_PAGE_SIZE) {
      page.push(null)
    }
    pages.push(page)
  }

  return pages
}
