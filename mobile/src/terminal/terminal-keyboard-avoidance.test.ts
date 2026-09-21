import { describe, expect, it } from 'vitest'
import { getTerminalKeyboardAvoidanceLift } from './terminal-keyboard-avoidance'

describe('getTerminalKeyboardAvoidanceLift', () => {
  it('keeps short output at the top fixed when the keyboard does not cover the cursor', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 300,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 0,
        rows: 30,
        altScreen: false,
        cursorBottomPx: 20,
        rowHeightPx: 20
      }
    })).toBe(0)
  })

  it('uses scaled pixel coordinates instead of assuming the terminal fills the frame height', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 300,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 29,
        rows: 30,
        altScreen: false,
        cursorBottomPx: 135,
        rowHeightPx: 4.5
      }
    })).toBe(0)
  })

  it('moves only the overlap needed to keep the cursor and one row visible', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 300,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 15,
        rows: 30,
        altScreen: false,
        cursorBottomPx: 320,
        rowHeightPx: 20
      }
    })).toBe(40)
  })

  it('caps the movement at the keyboard height for a cursor at the bottom', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 300,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 29,
        rows: 30,
        altScreen: false,
        cursorBottomPx: 600,
        rowHeightPx: 20
      }
    })).toBe(300)
  })

  it('fully lifts alternate-screen applications and terminals without metrics', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 280,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 0,
        rows: 30,
        altScreen: true,
        cursorBottomPx: 20,
        rowHeightPx: 20
      }
    })).toBe(280)
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 280,
      terminalFrameHeight: 600,
      metrics: null
    })).toBe(280)
  })

  it('does not move the terminal when the keyboard is hidden', () => {
    expect(getTerminalKeyboardAvoidanceLift({
      keyboardLift: 0,
      terminalFrameHeight: 600,
      metrics: {
        cursorY: 29,
        rows: 30,
        altScreen: false,
        cursorBottomPx: 600,
        rowHeightPx: 20
      }
    })).toBe(0)
  })
})
