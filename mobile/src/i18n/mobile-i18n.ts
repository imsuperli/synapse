import { DEFAULT_MOBILE_LANGUAGE, messages, type MobileLanguage, type MobileMessageKey } from './messages'

export type MobileTranslate = (
  key: MobileMessageKey,
  params?: Record<string, string | number>
) => string

export function isMobileLanguage(value: unknown): value is MobileLanguage {
  return value === 'zh-CN' || value === 'en'
}

export function nextMobileLanguage(language: MobileLanguage): MobileLanguage {
  return language === 'zh-CN' ? 'en' : 'zh-CN'
}

export function createMobileTranslator(language: MobileLanguage): MobileTranslate {
  return (key, params) => {
    const template: string =
      messages[language][key] ?? messages[DEFAULT_MOBILE_LANGUAGE][key] ?? String(key)
    if (!params) {
      return template
    }
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template
    )
  }
}
