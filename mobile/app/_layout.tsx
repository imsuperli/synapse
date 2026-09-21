import { useEffect } from 'react'
import { Image, Linking, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'
import { colors } from '../src/theme/mobile-theme'
import { MobileI18nProvider, useMobileI18n } from '../src/i18n'

const appIcon = require('../assets/icon.png')

export default function RootLayout() {
  return (
    <MobileI18nProvider>
      <RootStack />
    </MobileI18nProvider>
  )
}

function RootStack() {
  const router = useRouter()
  const { t } = useMobileI18n()

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
          <Stack.Screen
            name="index"
            options={{ headerTitle: () => <AppHeaderTitle title={t('nav.home')} /> }}
          />
          <Stack.Screen name="pair" options={{ title: t('nav.pair') }} />
          <Stack.Screen name="pair-scan" options={{ title: t('nav.pairDesktop') }} />
          <Stack.Screen name="pair-confirm" options={{ title: t('nav.confirmPairing') }} />
          <Stack.Screen name="h" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function AppHeaderTitle({ title }: { title: string }) {
  return (
    <View style={styles.headerTitle}>
      <Image source={appIcon} style={styles.headerLogo} />
      <Text style={styles.headerTitleText}>{title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  headerLogo: {
    width: 24,
    height: 24,
    borderRadius: 6
  },
  headerTitleText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700'
  }
})
