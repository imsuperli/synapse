import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const drawerSource = readFileSync(
  new URL('../components/CreateTerminalDrawer.tsx', import.meta.url),
  'utf8'
)
const bottomDrawerSource = readFileSync(
  new URL('../components/BottomDrawer.tsx', import.meta.url),
  'utf8'
)

describe('mobile terminal creation drawer wiring', () => {
  it('requires an explicit local or SSH creation form instead of creating on open', () => {
    expect(drawerSource).toContain("const [backend, setBackend] = useState<'local' | 'ssh'>('local')")
    expect(drawerSource).toContain("backend === 'local'")
    expect(drawerSource).toContain('profileId: selectedProfileId')
    expect(drawerSource).toContain('workingDirectory: localWorkingDirectory')
    expect(drawerSource).toContain('workingDirectory: remoteWorkingDirectory')
    expect(drawerSource).toContain('onSubmit(params)')
  })

  it('keeps the drawer visible while a creation request is in flight', () => {
    expect(drawerSource).toContain('dismissible={!submitting}')
    expect(bottomDrawerSource).toContain('dismissible?: boolean')
    expect(bottomDrawerSource).toContain('.enabled(dismissible)')
    expect(bottomDrawerSource).toContain('disabled={!dismissible}')
  })
})
