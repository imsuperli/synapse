import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/settings.tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile host settings route wiring', () => {
  it('confirms paired desktop removal before deleting local tokens', () => {
    expect(routeSource).toContain("import { Alert, StyleSheet, Text, View } from 'react-native'")
    expect(routeSource).toContain("import { Pressable } from '../../../src/components/Pressable'")
    expect(routeSource).toContain("Alert.alert(t('hostSettings.removeTitle'), t('hostSettings.removeConfirm')")
    expect(routeSource).toContain("style: 'destructive'")
    expect(routeSource).toContain('removeHost(hostId)')
  })
})
