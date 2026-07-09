import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { DEFAULT_MOBILE_LANGUAGE, MOBILE_LANGUAGE_LABELS, type MobileLanguage } from './messages'
import {
  createMobileTranslator,
  isMobileLanguage,
  nextMobileLanguage,
  type MobileTranslate
} from './mobile-i18n'

const LANGUAGE_STORAGE_KEY = 'synapse:mobileLanguage'

type MobileI18nContextValue = {
  language: MobileLanguage
  languageLabel: string
  nextLanguage: MobileLanguage
  nextLanguageLabel: string
  t: MobileTranslate
  setLanguage: (language: MobileLanguage) => Promise<void>
  toggleLanguage: () => Promise<void>
}

const MobileI18nContext = createContext<MobileI18nContextValue | null>(null)

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<MobileLanguage>(DEFAULT_MOBILE_LANGUAGE)

  useEffect(() => {
    let cancelled = false
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
      if (!cancelled && isMobileLanguage(stored)) {
        setLanguageState(stored)
      }
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const setLanguage = useCallback(async (next: MobileLanguage) => {
    setLanguageState(next)
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next)
  }, [])

  const toggleLanguage = useCallback(async () => {
    await setLanguage(nextMobileLanguage(language))
  }, [language, setLanguage])

  const value = useMemo<MobileI18nContextValue>(() => {
    const nextLanguage = nextMobileLanguage(language)
    return {
      language,
      languageLabel: MOBILE_LANGUAGE_LABELS[language],
      nextLanguage,
      nextLanguageLabel: MOBILE_LANGUAGE_LABELS[nextLanguage],
      t: createMobileTranslator(language),
      setLanguage,
      toggleLanguage
    }
  }, [language, setLanguage, toggleLanguage])

  return <MobileI18nContext.Provider value={value}>{children}</MobileI18nContext.Provider>
}

export function useMobileI18n(): MobileI18nContextValue {
  const value = useContext(MobileI18nContext)
  if (!value) {
    throw new Error('useMobileI18n must be used inside MobileI18nProvider')
  }
  return value
}

export type { MobileTranslate } from './mobile-i18n'
