import { describe, expect, it } from 'bun:test'
import { de } from './de'
import { type Dictionary, translateText } from './translate'

const dictionary: Dictionary = {
  exact: { Walls: 'Wände', 'Add level': 'Geschoss hinzufügen' },
  patterns: [[/Level (\d+)/, (n) => `Geschoss ${n}`]],
}

describe('translateText', () => {
  it('translates an exact match and keeps surrounding whitespace', () => {
    expect(translateText('Walls', dictionary)).toBe('Wände')
    expect(translateText('  Add level ', dictionary)).toBe('  Geschoss hinzufügen ')
  })

  it('translates a whole-text pattern match', () => {
    expect(translateText('Level 3', dictionary)).toBe('Geschoss 3')
    expect(translateText('Level 3 of 4', dictionary)).toBeNull()
  })

  it('leaves unknown text, single characters and already translated text alone', () => {
    expect(translateText('Shiny new tool', dictionary)).toBeNull()
    expect(translateText('W', dictionary)).toBeNull()
    expect(translateText('Wände', dictionary)).toBeNull()
  })

  it('does not treat Object.prototype keys as entries', () => {
    expect(translateText('constructor', dictionary)).toBeNull()
  })
})

describe('German dictionary', () => {
  it('never maps a translation back onto another English key', () => {
    // The DOM translator re-reads text it changed; a German value that is also
    // an English key would be translated twice.
    const chained = Object.entries(de.exact).filter(
      ([english, german]) =>
        german !== english && Object.hasOwn(de.exact, german) && de.exact[german] !== german,
    )
    expect(chained).toEqual([])
  })
})
