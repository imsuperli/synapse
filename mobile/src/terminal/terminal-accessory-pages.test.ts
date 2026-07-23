import { describe, expect, it } from 'vitest'

import { TERMINAL_ACCESSORY_KEYS, type TerminalAccessoryKey } from './terminal-accessory-keys'
import {
  buildTerminalAccessoryPages,
  TERMINAL_ACCESSORY_PAGE_COLUMNS,
  TERMINAL_ACCESSORY_PAGE_SIZE
} from './terminal-accessory-pages'

function slotIds(page: ReturnType<typeof buildTerminalAccessoryPages>[number]) {
  return page.map((slot) => slot?.id ?? null)
}

describe('buildTerminalAccessoryPages', () => {
  it('builds two complete rows of seven slots per page', () => {
    const pages = buildTerminalAccessoryPages(TERMINAL_ACCESSORY_KEYS)

    expect(TERMINAL_ACCESSORY_PAGE_COLUMNS).toBe(7)
    expect(TERMINAL_ACCESSORY_PAGE_SIZE).toBe(14)
    expect(pages).toHaveLength(2)
    expect(pages.every((page) => page.length === TERMINAL_ACCESSORY_PAGE_SIZE)).toBe(true)
  })

  it('keeps primary editing and navigation keys at their fixed positions', () => {
    const [primaryPage] = buildTerminalAccessoryPages(TERMINAL_ACCESSORY_KEYS)

    expect(slotIds(primaryPage!)).toEqual([
      'escape',
      'paste',
      'shiftTab',
      'home',
      'arrowUp',
      'end',
      'backspace',
      'tab',
      'ctrl',
      'alt',
      'arrowLeft',
      'arrowDown',
      'arrowRight',
      'enter'
    ])
    expect(primaryPage![8]).toEqual(
      expect.objectContaining({ type: 'modifier', modifier: 'ctrl', label: 'Ctrl' })
    )
    expect(primaryPage![9]).toEqual(
      expect.objectContaining({ type: 'modifier', modifier: 'alt', label: 'Alt' })
    )
  })

  it('places Ctrl shortcuts on the second page and leaves stable empty slots', () => {
    const [, ctrlPage] = buildTerminalAccessoryPages(TERMINAL_ACCESSORY_KEYS)

    expect(slotIds(ctrlPage!)).toEqual([
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
    ])
  })

  it('preserves primary-page positions when a key is unavailable', () => {
    const withoutHome = TERMINAL_ACCESSORY_KEYS.filter((key) => key.id !== 'home')
    const [primaryPage] = buildTerminalAccessoryPages(withoutHome)

    expect(primaryPage![3]).toBeNull()
    expect(primaryPage![4]?.id).toBe('arrowUp')
    expect(primaryPage![10]?.id).toBe('arrowLeft')
    expect(primaryPage![11]?.id).toBe('arrowDown')
    expect(primaryPage![12]?.id).toBe('arrowRight')
  })

  it('adds more full pages when extra keys exceed the second page', () => {
    const customKeys: TerminalAccessoryKey[] = Array.from({ length: 6 }, (_, index) => ({
      id: `custom-${index}`,
      label: `C${index}`,
      bytes: `${index}`
    }))
    const pages = buildTerminalAccessoryPages([...TERMINAL_ACCESSORY_KEYS, ...customKeys])

    expect(pages).toHaveLength(3)
    expect(slotIds(pages[1]!)).toEqual([
      'ctrlC',
      'ctrlD',
      'ctrlL',
      'ctrlZ',
      'ctrlR',
      'custom-0',
      'custom-1',
      'ctrlA',
      'ctrlE',
      'ctrlW',
      'ctrlU',
      'custom-2',
      'custom-3',
      'custom-4'
    ])
    expect(slotIds(pages[2]!).slice(0, 2)).toEqual(['custom-5', null])
  })
})
