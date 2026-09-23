import { describe, expect, it } from 'vitest'

import {
  estimateSectionHomography,
  getCoverCoordinateSpace,
  IDENTITY_HOMOGRAPHY,
  invertHomography,
  projectBox,
  projectPoint,
} from './cartonArTracking'

describe('getCoverCoordinateSpace', () => {
  it('matches object-fit cover when a landscape camera fills a portrait stage', () => {
    const space = getCoverCoordinateSpace(1920, 1080, 390, 600)

    expect(space.height).toBeCloseTo(600)
    expect(space.width).toBeGreaterThan(390)
    expect(space.left).toBeLessThan(0)
    expect(space.top).toBeCloseTo(0)
  })
})

describe('section homography', () => {
  it('follows camera translation from one persistent label', () => {
    const anchor = { x: 0.2, y: 0.3, width: 0.2, height: 0.1 }
    const current = { x: 0.27, y: 0.25, width: 0.2, height: 0.1 }
    const estimate = estimateSectionHomography([{ anchor, current }], IDENTITY_HOMOGRAPHY)
    const projected = projectPoint(estimate.matrix, 0.3, 0.35)

    expect(estimate.mode).toBe('translation')
    expect(projected.x).toBeGreaterThan(0.32)
    expect(projected.y).toBeLessThan(0.35)
  })

  it('projects remembered label boxes and can map them back into anchor space', () => {
    const correspondences = [
      {
        anchor: { x: 0.12, y: 0.2, width: 0.18, height: 0.09 },
        current: { x: 0.18, y: 0.22, width: 0.2, height: 0.1 },
      },
      {
        anchor: { x: 0.55, y: 0.5, width: 0.17, height: 0.08 },
        current: { x: 0.61, y: 0.52, width: 0.19, height: 0.09 },
      },
      {
        anchor: { x: 0.34, y: 0.68, width: 0.16, height: 0.08 },
        current: { x: 0.4, y: 0.7, width: 0.18, height: 0.09 },
      },
    ]

    const estimate = estimateSectionHomography(correspondences, IDENTITY_HOMOGRAPHY)
    const remembered = { x: 0.4, y: 0.35, width: 0.18, height: 0.09 }
    const projected = projectBox(estimate.matrix, remembered)
    const recovered = projectBox(invertHomography(estimate.matrix), projected)

    expect(estimate.landmarks).toBe(3)
    expect(projected.x).toBeGreaterThan(remembered.x)
    expect(recovered.x).toBeCloseTo(remembered.x, 2)
    expect(recovered.y).toBeCloseTo(remembered.y, 2)
  })

  it('does not let one bad label match drag the remembered pallet positions', () => {
    const correspondences = [
      {
        anchor: { x: 0.15, y: 0.15, width: 0.12, height: 0.06 },
        current: { x: 0.2, y: 0.17, width: 0.12, height: 0.06 },
      },
      {
        anchor: { x: 0.55, y: 0.15, width: 0.12, height: 0.06 },
        current: { x: 0.6, y: 0.17, width: 0.12, height: 0.06 },
      },
      {
        anchor: { x: 0.15, y: 0.55, width: 0.12, height: 0.06 },
        current: { x: 0.2, y: 0.57, width: 0.12, height: 0.06 },
      },
      {
        anchor: { x: 0.55, y: 0.55, width: 0.12, height: 0.06 },
        current: { x: 0.02, y: 0.82, width: 0.12, height: 0.06 },
      },
    ]

    const estimate = estimateSectionHomography(correspondences, IDENTITY_HOMOGRAPHY)
    const projected = projectPoint(estimate.matrix, 0.35, 0.35)

    expect(estimate.mode).toBe('translation')
    expect(projected.x).toBeGreaterThan(0.36)
    expect(projected.x).toBeLessThan(0.4)
    expect(projected.y).toBeGreaterThan(0.35)
    expect(projected.y).toBeLessThan(0.38)
  })
})
