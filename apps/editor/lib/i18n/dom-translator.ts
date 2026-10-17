import { type Dictionary, translateText } from './translate'

const ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'])

/**
 * Translates the rendered DOM under `root` and keeps translating what React
 * renders later. Text nodes are changed in place (never replaced), which React
 * tolerates because it overwrites `nodeValue`/`textContent` on its next update
 * instead of reading it back. Start it only after hydration: translated server
 * HTML would not match what React expects to hydrate.
 *
 * Opt out a subtree with `translate="no"` or `data-no-translate`.
 */
export function startDomTranslator(root: HTMLElement, dictionary: Dictionary): () => void {
  const translateNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node as Text, dictionary)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (isSkipped(element)) return
    translateAttributes(element, dictionary)
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (candidate) =>
          candidate.nodeType === Node.ELEMENT_NODE && isSkipped(candidate as Element)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    )
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text, dictionary)
      else translateAttributes(current as Element, dictionary)
    }
  }

  translateNode(root)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target.parentElement
        if (parent && !closestSkipped(parent)) translateTextNode(record.target as Text, dictionary)
      } else if (record.type === 'attributes') {
        const element = record.target as Element
        if (!closestSkipped(element)) translateAttributes(element, dictionary)
      } else {
        const parent = record.target as Element
        if (closestSkipped(parent)) continue
        for (const added of record.addedNodes) translateNode(added)
      }
    }
  })
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  })
  return () => observer.disconnect()
}

function translateTextNode(node: Text, dictionary: Dictionary) {
  const translated = translateText(node.nodeValue ?? '', dictionary)
  if (translated !== null) node.nodeValue = translated
}

function translateAttributes(element: Element, dictionary: Dictionary) {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (!value) continue
    const translated = translateText(value, dictionary)
    if (translated !== null) element.setAttribute(name, translated)
  }
}

function isSkipped(element: Element): boolean {
  return (
    SKIPPED_TAGS.has(element.tagName) ||
    element.getAttribute('translate') === 'no' ||
    element.hasAttribute('data-no-translate') ||
    (element as HTMLElement).isContentEditable
  )
}

function closestSkipped(element: Element): boolean {
  return (
    element.closest('script,style,textarea,code,pre,[translate="no"],[data-no-translate]') !== null
  )
}
