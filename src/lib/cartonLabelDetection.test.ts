import { describe, expect, it } from 'vitest'

import { boxCenterDistance, boxIou, boxSizeDifference, type LabelBox } from './cartonLabelDetection'

describe('carton label tracking geometry', () => {
  const label: LabelBox = { x: 0.2, y: 0.3, width: 0.18, height: 0.08 }

  it('keeps a slightly moved white label associated with the same track', () => {
    const moved: LabelBox = { x: 0.215, y: 0.305, width: 0.176, height: 0.082 }
    expect(boxIou(label, moved)).toBeGreaterThan(0.7)
    expect(boxCenterDistance(label, moved)).toBeLessThan(0.03)
    expect(boxSizeDifference(label, moved)).toBeLessThan(0.1)
  })

  it('separates labels in different carton positions', () => {
    const other: LabelBox = { x: 0.62, y: 0.3, width: 0.18, height: 0.08 }
    expect(boxIou(label, other)).toBe(0)
    expect(boxCenterDistance(label, other)).toBeGreaterThan(0.4)
  })
})
