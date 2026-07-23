import { describe, expect, it } from 'vitest'

import {
  buildTerminalOneShotNativeKeyBytes,
  buildTerminalOneShotTextBytes,
  EMPTY_TERMINAL_ONE_SHOT_MODIFIERS,
  getTerminalOneShotModifierList,
  hasTerminalOneShotModifiers,
  toggleTerminalOneShotModifier
} from './terminal-one-shot-modifiers'

describe('terminal one-shot modifiers', () => {
  it('toggles Ctrl and Alt independently in terminal modifier order', () => {
    const ctrl = toggleTerminalOneShotModifier(EMPTY_TERMINAL_ONE_SHOT_MODIFIERS, 'ctrl')
    const both = toggleTerminalOneShotModifier(ctrl, 'alt')

    expect(hasTerminalOneShotModifiers(ctrl)).toBe(true)
    expect(getTerminalOneShotModifierList(both)).toEqual(['ctrl', 'alt'])
    expect(toggleTerminalOneShotModifier(both, 'ctrl')).toEqual({ ctrl: false, alt: true })
  })

  it('encodes one inserted software-keyboard character as a Ctrl chord', () => {
    expect(buildTerminalOneShotTextBytes('hello', 'helloc', { ctrl: true, alt: false })).toBe(
      '\x03'
    )
  })

  it('encodes a replaced software-keyboard character without depending on its position', () => {
    expect(buildTerminalOneShotTextBytes('abc', 'aXc', { ctrl: false, alt: true })).toBe('\x1bX')
  })

  it('prefixes an Alt-modified committed Unicode character with Escape', () => {
    expect(buildTerminalOneShotTextBytes('', '知', { ctrl: false, alt: true })).toBe('\x1b知')
  })

  it('does not invent Ctrl encodings for unsupported or multi-character edits', () => {
    expect(buildTerminalOneShotTextBytes('', '1', { ctrl: true, alt: false })).toBeNull()
    expect(buildTerminalOneShotTextBytes('', 'ab', { ctrl: true, alt: false })).toBeNull()
  })

  it('encodes native special keys with either or both modifiers', () => {
    expect(buildTerminalOneShotNativeKeyBytes('ArrowRight', { ctrl: true, alt: false })).toBe(
      '\x1b[1;5C'
    )
    expect(buildTerminalOneShotNativeKeyBytes('Backspace', { ctrl: false, alt: true })).toBe(
      '\x1b\x7f'
    )
    expect(buildTerminalOneShotNativeKeyBytes('Enter', { ctrl: true, alt: true })).toBe('\x1b\r')
  })

  it('ignores native keys when no modifier is armed', () => {
    expect(buildTerminalOneShotNativeKeyBytes('ArrowRight', { ctrl: false, alt: false })).toBeNull()
    expect(
      buildTerminalOneShotNativeKeyBytes('Unidentified', { ctrl: true, alt: false })
    ).toBeNull()
  })
})
