import { describe, expect, it } from 'vitest'

import { IDENTITY_HOMOGRAPHY } from './cartonArTracking'
import { associateLabelDetections, type TrackAssociationInput } from './cartonTrackAssociation'

function track(x: number, status = 'tracking'): TrackAssociationInput {
  const box = { x, y: 0.3, width: 0.08, height: 0.04 }
  return { box, anchorBox: box, missedFrames: 0, stableFrames: 4, status }
}

describe('associateLabelDetections', () => {
  it('does not let an ambiguous early detection steal a much better neighboring match', () => {
    const tracks = [track(0.2, 'accepted'), track(0.31)]
    const detections = [
      { box: { x: 0.27, y: 0.301, width: 0.08, height: 0.04 }, score: 0.8 },
      { box: { x: 0.202, y: 0.299, width: 0.08, height: 0.04 }, score: 0.82 },
    ]

    const result = associateLabelDetections(tracks, detections, IDENTITY_HOMOGRAPHY)
    const byTrack = new Map(result.matches.map((match) => [match.trackIndex, match.detectionIndex]))

    expect(byTrack.get(0)).toBe(1)
    expect(byTrack.get(1)).toBe(0)
  })

  it('leaves implausibly distant detections unmatched instead of swapping tracks', () => {
    const tracks = [track(0.2)]
    const detections = [
      { box: { x: 0.42, y: 0.3, width: 0.08, height: 0.04 }, score: 0.9 },
    ]

    const result = associateLabelDetections(tracks, detections, IDENTITY_HOMOGRAPHY)

    expect(result.matches).toHaveLength(0)
    expect(result.unmatchedTrackIndices).toEqual([0])
    expect(result.unmatchedDetectionIndices).toEqual([0])
  })
})
