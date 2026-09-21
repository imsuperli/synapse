import { buildTerminalShortcutKey, type TerminalShortcutModifier } from './terminal-accessory-keys'

export type TerminalOneShotModifier = 'ctrl' | 'alt'

export type TerminalOneShotModifiers = Readonly<{
  ctrl: boolean
  alt: boolean
}>

export const EMPTY_TERMINAL_ONE_SHOT_MODIFIERS: TerminalOneShotModifiers = Object.freeze({
  ctrl: false,
  alt: false
})

const NATIVE_SPECIAL_KEYS: Readonly<Record<string, string>> = {
  Escape: 'escape',
  Esc: 'escape',
  Tab: 'tab',
  Enter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  ArrowUp: 'arrowUp',
  ArrowDown: 'arrowDown',
  ArrowLeft: 'arrowLeft',
  ArrowRight: 'arrowRight',
  Home: 'home',
  End: 'end',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  F1: 'f1',
  F2: 'f2',
  F3: 'f3',
  F4: 'f4',
  F5: 'f5',
  F6: 'f6',
  F7: 'f7',
  F8: 'f8',
  F9: 'f9',
  F10: 'f10',
  F11: 'f11',
  F12: 'f12'
}

export function hasTerminalOneShotModifiers(modifiers: TerminalOneShotModifiers): boolean {
  return modifiers.ctrl || modifiers.alt
}

export function toggleTerminalOneShotModifier(
  modifiers: TerminalOneShotModifiers,
  modifier: TerminalOneShotModifier
): TerminalOneShotModifiers {
  return { ...modifiers, [modifier]: !modifiers[modifier] }
}

export function getTerminalOneShotModifierList(
  modifiers: TerminalOneShotModifiers
): TerminalShortcutModifier[] {
  const selected: TerminalShortcutModifier[] = []
  if (modifiers.ctrl) {
    selected.push('ctrl')
  }
  if (modifiers.alt) {
    selected.push('alt')
  }
  return selected
}

export function buildTerminalOneShotNativeKeyBytes(
  nativeKey: string,
  modifiers: TerminalOneShotModifiers
): string | null {
  const key = NATIVE_SPECIAL_KEYS[nativeKey]
  if (!key || !hasTerminalOneShotModifiers(modifiers)) {
    return null
  }
  return (
    buildTerminalShortcutKey({
      key,
      modifiers: getTerminalOneShotModifierList(modifiers)
    })?.bytes ?? null
  )
}

export function buildTerminalOneShotTextBytes(
  previousText: string,
  nextText: string,
  modifiers: TerminalOneShotModifiers
): string | null {
  if (!hasTerminalOneShotModifiers(modifiers)) {
    return null
  }

  const insertedCodePoints = insertedTextCodePoints(previousText, nextText)
  if (insertedCodePoints.length !== 1) {
    return null
  }
  const inserted = insertedCodePoints[0]!
  // Meta/Alt is the original committed character prefixed by ESC. Bypassing
  // shortcut-key normalization preserves the software keyboard's letter case.
  if (modifiers.alt && !modifiers.ctrl) {
    return `\x1b${inserted}`
  }
  const modifierList = getTerminalOneShotModifierList(modifiers)
  const shortcut = buildTerminalShortcutKey({ key: inserted, modifiers: modifierList })
  if (shortcut) {
    return shortcut.bytes
  }

  // Ctrl has no portable terminal encoding outside its supported ASCII set.
  return null
}

function insertedTextCodePoints(previousText: string, nextText: string): string[] {
  const previous = Array.from(previousText)
  const next = Array.from(nextText)
  let prefixLength = 0
  while (
    prefixLength < previous.length &&
    prefixLength < next.length &&
    previous[prefixLength] === next[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < previous.length - prefixLength &&
    suffixLength < next.length - prefixLength &&
    previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return next.slice(prefixLength, next.length - suffixLength)
}
