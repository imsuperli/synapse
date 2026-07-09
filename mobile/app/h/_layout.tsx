import { Stack } from 'expo-router'
import { colors } from '../../src/theme/mobile-theme'

export default function HostLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgBase },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bgBase }
      }}
    >
      <Stack.Screen name="[hostId]/index" options={{ title: 'Desktop' }} />
      <Stack.Screen name="[hostId]/settings" options={{ title: 'Host Settings' }} />
      <Stack.Screen name="[hostId]/t/[windowId]/[paneId]" options={{ title: 'Terminal' }} />
    </Stack>
  )
}
