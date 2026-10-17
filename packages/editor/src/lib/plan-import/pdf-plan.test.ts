import { describe, expect, it } from 'bun:test'
import { findPrintedScale } from './pdf-plan'

describe('findPrintedScale', () => {
  it('reads the scale from a title block, also when split into text runs', () => {
    expect(findPrintedScale('Grundriss EG Massstab: 1:100 Datum 22.08.2024')).toBe(100)
    expect(findPrintedScale('M 1 : 50')).toBe(50)
  })

  it('prefers the most frequent ratio', () => {
    expect(findPrintedScale('Detail 1:20 Grundriss 1:100 Schnitt 1:100')).toBe(100)
  })

  it('ignores times, dates and numbers that only end in 1', () => {
    expect(findPrintedScale('Termin 11:30, Plan 21:100, 1.1:5')).toBeNull()
  })
})
