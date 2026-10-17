/**
 * Text-level translation for the Wohndesign fork.
 *
 * Upstream Pascal writes its UI strings inline in English and changes almost
 * daily. Wrapping every string in `t()` would touch hundreds of files and
 * conflict with each upstream merge, so the fork translates rendered text
 * instead: a dictionary keyed by the exact English string, plus patterns for
 * strings with numbers or names in them. A missing entry falls back to English.
 */

export type Pattern = readonly [RegExp, (...groups: string[]) => string]

export type Dictionary = {
  /** Exact English text → translation. Matched after trimming whitespace. */
  readonly exact: Readonly<Record<string, string>>
  /** Tried in order when there is no exact match; the regex must match the whole trimmed text. */
  readonly patterns: readonly Pattern[]
}

/**
 * Returns the translated text with the original leading/trailing whitespace,
 * or `null` when the text has no translation.
 */
export function translateText(text: string, dictionary: Dictionary): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 2) return null

  let translated: string | undefined = Object.hasOwn(dictionary.exact, trimmed)
    ? dictionary.exact[trimmed]
    : undefined
  if (translated === undefined) {
    for (const [regex, replace] of dictionary.patterns) {
      const match = regex.exec(trimmed)
      if (match && match[0] === trimmed) {
        translated = replace(...match.slice(1))
        break
      }
    }
  }
  if (translated === undefined || translated === trimmed) return null

  const start = text.indexOf(trimmed)
  return text.slice(0, start) + translated + text.slice(start + trimmed.length)
}
