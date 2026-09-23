import { describe, expect, it } from 'vitest'

import { rotateNormalizedRect } from './deviceOrientation'

describe('rotateNormalizedRect', () => {
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.15 }

  it('rotates an EAN detection 90 degrees clockwise in normalized camera space', () => {
    expect(rotateNormalizedRect(rect, 90)).toEqual({
      x: 0.65,
      y: 0.1,
      width: 0.15,
      height: 0.3,
    })
  })

  it('rotates an EAN detection 270 degrees clockwise in normalized camera space', () => {
    const rotated = rotateNormalizedRect(rect, 270)
    expect(rotated.x).toBeCloseTo(0.2)
    expect(rotated.y).toBeCloseTo(0.6)
    expect(rotated.width).toBeCloseTo(0.15)
    expect(rotated.height).toBeCloseTo(0.3)
  })

  it('leaves automatic orientation coordinates unchanged', () => {
    expect(rotateNormalizedRect(rect, 0)).toEqual(rect)
  })
})
