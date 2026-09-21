import { describe, expect, it } from 'vitest'

import { DEFAULT_MOBILE_LANGUAGE, messages } from './messages'
import { createMobileTranslator, nextMobileLanguage } from './mobile-i18n'

describe('mobile i18n', () => {
  it('defaults to Chinese', () => {
    expect(DEFAULT_MOBILE_LANGUAGE).toBe('zh-CN')
  })

  it('translates Chinese and English messages', () => {
    expect(createMobileTranslator('zh-CN')('home.pair')).toBe('配对')
    expect(createMobileTranslator('en')('home.pair')).toBe('Pair')
  })

  it('interpolates message parameters', () => {
    expect(createMobileTranslator('zh-CN')('confirm.connectTimeout', { seconds: 25 })).toBe(
      '在 25 秒内无法连接。请检查电脑端地址和网络。'
    )
    expect(createMobileTranslator('en')('confirm.connectTimeout', { seconds: 25 })).toBe(
      "Couldn't connect within 25s. Check the desktop endpoint."
    )
  })

  it('switches between supported languages', () => {
    expect(nextMobileLanguage('zh-CN')).toBe('en')
    expect(nextMobileLanguage('en')).toBe('zh-CN')
  })

  it('keeps Chinese and English message keys aligned', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages['zh-CN']).sort())
  })
})
