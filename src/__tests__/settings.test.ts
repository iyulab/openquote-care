import { describe, expect, it } from 'vitest'
import { languageChoices } from '../settings.js'
import { useLocale } from '../strings.js'

describe('the language setting', () => {
  it('offers following the system, naming what that speaks, then each language in its own words', () => {
    try {
      useLocale('ko')
      expect(languageChoices('ko-KR')).toEqual([
        { value: 'system', label: 'Windows 설정 따름 (한국어)' },
        { value: 'ko', label: '한국어' },
        { value: 'en', label: 'English' },
      ])
      useLocale('en')
      expect(languageChoices('fr-FR')[0]).toEqual({ value: 'system', label: 'As in Windows (English)' })
      expect(languageChoices('fr-FR')[1]).toEqual({ value: 'ko', label: '한국어' })
    } finally {
      useLocale('ko')
    }
  })
})
