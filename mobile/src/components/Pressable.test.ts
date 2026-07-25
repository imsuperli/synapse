import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PressableStateCallbackType } from 'react-native'
import { resolveMobilePressableStyle } from './Pressable'

const idleState: PressableStateCallbackType = { pressed: false }
const pressedState: PressableStateCallbackType = { pressed: true }

describe('mobile Pressable feedback', () => {
  it('keeps the caller style and adds feedback while pressed', () => {
    const callerStyle = { backgroundColor: '#123456' }

    expect(resolveMobilePressableStyle(callerStyle, pressedState, false)).toEqual([
      callerStyle,
      { opacity: 0.72 }
    ])
  })

  it('passes the native press state to caller style callbacks', () => {
    const style = (state: PressableStateCallbackType) => ({
      opacity: state.pressed ? 0.5 : 1
    })

    expect(resolveMobilePressableStyle(style, idleState, false)).toEqual([
      { opacity: 1 },
      null
    ])
  })

  it('does not show press feedback for disabled controls', () => {
    expect(resolveMobilePressableStyle(undefined, pressedState, true)).toEqual([undefined, null])
  })

  it('routes every mobile Pressable through the shared feedback component', () => {
    const mobileRoot = join(import.meta.dirname, '../..')
    const sourceRoots = [join(mobileRoot, 'app'), join(mobileRoot, 'src')]
    const violations: string[] = []
    let pressableCount = 0

    const inspectDirectory = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          inspectDirectory(path)
          continue
        }
        if (!entry.name.endsWith('.tsx')) {
          continue
        }
        const source = readFileSync(path, 'utf8')
        const matches = source.match(/<Pressable\b/g)
        if (!matches) {
          continue
        }
        pressableCount += matches.length
        if (!/import \{ Pressable \} from ['"][^'"]*\/Pressable['"]/.test(source)) {
          violations.push(path)
        }
        if (/import\s*\{[^}]*\bPressable\b[^}]*\}\s*from ['"]react-native['"]/s.test(source)) {
          violations.push(`${path} imports the native Pressable`)
        }
      }
    }

    sourceRoots.forEach(inspectDirectory)

    expect(pressableCount).toBeGreaterThan(0)
    expect(violations).toEqual([])
  })
})
