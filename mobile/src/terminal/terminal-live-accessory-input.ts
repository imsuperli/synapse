import {
  buildTerminalShortcutKey,
  type TerminalAccessoryKey,
  type TerminalShortcutBinding,
  type TerminalShortcutModifier
} from './terminal-accessory-keys'
import type { TerminalLiveAccessoryLocalEdit } from './terminal-live-text-commit'

export type TerminalLiveAccessoryInput = {
  readonly bytes: string
  readonly localEdit?: TerminalLiveAccessoryLocalEdit
}

const ACCESSORY_SHORTCUT_BINDINGS: Readonly<Record<string, TerminalShortcutBinding>> = {
  escape: { key: 'escape', modifiers: [] },
  tab: { key: 'tab', modifiers: [] },
  enter: { key: 'enter', modifiers: [] },
  shiftTab: { key: 'tab', modifiers: ['shift'] },
  space: { key: 'space', modifiers: [] },
  backspace: { key: 'backspace', modifiers: [] },
  delete: { key: 'delete', modifiers: [] },
  arrowUp: { key: 'arrowUp', modifiers: [] },
  arrowDown: { key: 'arrowDown', modifiers: [] },
  arrowLeft: { key: 'arrowLeft', modifiers: [] },
  arrowRight: { key: 'arrowRight', modifiers: [] },
  home: { key: 'home', modifiers: [] },
  end: { key: 'end', modifiers: [] },
  ctrlC: { key: 'c', modifiers: ['ctrl'] },
  ctrlD: { key: 'd', modifiers: ['ctrl'] },
  ctrlL: { key: 'l', modifiers: ['ctrl'] },
  ctrlZ: { key: 'z', modifiers: ['ctrl'] },
  ctrlR: { key: 'r', modifiers: ['ctrl'] },
  ctrlA: { key: 'a', modifiers: ['ctrl'] },
  ctrlE: { key: 'e', modifiers: ['ctrl'] },
  ctrlW: { key: 'w', modifiers: ['ctrl'] },
  ctrlU: { key: 'u', modifiers: ['ctrl'] }
}

export function createTerminalLiveAccessoryInput(
  key: TerminalAccessoryKey,
  activeModifiers: readonly TerminalShortcutModifier[] = []
): TerminalLiveAccessoryInput {
  if (activeModifiers.length > 0) {
    const binding = ACCESSORY_SHORTCUT_BINDINGS[key.id]
    if (binding) {
      const modifiers = Array.from(new Set([...binding.modifiers, ...activeModifiers]))
      const shortcut = buildTerminalShortcutKey({ key: binding.key, modifiers })
      if (shortcut) {
        return { bytes: shortcut.bytes }
      }
    }
  }

  if (key.id === 'backspace' || key.id === 'delete') {
    return { bytes: key.bytes, localEdit: key.id }
  }

  return { bytes: key.bytes }
}
