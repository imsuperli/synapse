import { useEffect } from 'react'
import { Linking } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'
import { colors } from '../src/theme/mobile-theme'

export default function RootLayout() {
  const router = useRouter()

  useEffect(() => {
    const openPairingUrl = (url: string | null) => {
      if (!url) {
        return
      }
      const code = extractPairingCodeFromUrl(url)
      if (code) {
        router.replace({ pathname: '/pair-confirm', params: { code } })
      }
    }

    void Linking.getInitialURL().then(openPairingUrl)
    const subscription = Linking.addEventListener('url', (event) => openPairingUrl(event.url))
    return () => subscription.remove()
  }, [router])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bgBase },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bgBase }
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Synapse Mobile' }} />
          <Stack.Screen name="pair" options={{ title: 'Pair' }} />
          <Stack.Screen name="pair-scan" options={{ title: 'Pair Desktop' }} />
          <Stack.Screen name="pair-confirm" options={{ title: 'Confirm Pairing' }} />
          <Stack.Screen name="h" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
