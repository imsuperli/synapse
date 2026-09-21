import { Stack } from 'expo-router'
import { colors } from '../../src/theme/mobile-theme'
import { useMobileI18n } from '../../src/i18n'

export default function HostLayout() {
  const { t } = useMobileI18n()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgBase },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bgBase }
      }}
    >
      <Stack.Screen name="[hostId]/index" options={{ title: t('nav.desktop') }} />
      <Stack.Screen name="[hostId]/settings" options={{ title: t('nav.hostSettings') }} />
      <Stack.Screen name="[hostId]/t/[windowId]/[paneId]" options={{ title: t('nav.terminal') }} />
    </Stack>
  )
}
