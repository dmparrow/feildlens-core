import {
  boxCenterDistance,
  boxIou,
  boxSizeDifference,
  type LabelBox,
  type LabelDetection,
} from './cartonLabelDetection'
import { projectBox, type Homography } from './cartonArTracking'

export type TrackAssociationInput = {
  box: LabelBox
  anchorBox: LabelBox
  missedFrames: number
  stableFrames: number
  status: string
}

export type TrackAssociationMatch = {
  trackIndex: number
  detectionIndex: number
  expectedBox: LabelBox
  score: number
  iou: number
  normalizedDistance: number
  sizeDifference: number
}

type CandidateMatch = TrackAssociationMatch

function aspectDifference(left: LabelBox, right: LabelBox) {
  const leftAspect = left.width / Math.max(0.0001, left.height)
  const rightAspect = right.width / Math.max(0.0001, right.height)
  return Math.abs(Math.log(Math.max(0.0001, leftAspect) / Math.max(0.0001, rightAspect)))
}

function matchRadius(box: LabelBox, missedFrames: number) {
  const diagonal = Math.hypot(box.width, box.height)
  const base = Math.max(0.024, Math.min(0.068, diagonal * 0.58))
  return base * (1 + Math.min(2, missedFrames) * 0.18)
}

function persistenceBonus(track: TrackAssociationInput) {
  const stable = Math.min(track.stableFrames, 6) * 0.035
  if (track.status === 'accepted') return stable + 0.18
  if (track.status === 'queued' || track.status === 'reading') return stable + 0.08
  return stable
}

export function associateLabelDetections(
  tracks: TrackAssociationInput[],
  detections: LabelDetection[],
  transform: Homography,
) {
  const candidates: CandidateMatch[] = []

  tracks.forEach((track, trackIndex) => {
    const expectedBox = track.missedFrames > 0 ? projectBox(transform, track.anchorBox) : track.box
    const radius = matchRadius(expectedBox, track.missedFrames)
    const maxSizeDifference = track.missedFrames > 0 ? 0.5 : 0.42

    detections.forEach((detection, detectionIndex) => {
      const iou = boxIou(expectedBox, detection.box)
      const distance = boxCenterDistance(expectedBox, detection.box)
      const sizeDifference = boxSizeDifference(expectedBox, detection.box)
      const shapeDifference = aspectDifference(expectedBox, detection.box)

      if (sizeDifference > maxSizeDifference || shapeDifference > 0.42) return
      if (iou < 0.12 && distance > radius) return

      const normalizedDistance = distance / Math.max(0.001, radius)
      const score =
        iou * 4
        - normalizedDistance * 1.65
        - sizeDifference * 0.9
        - shapeDifference * 0.45
        + detection.score * 0.18
        + persistenceBonus(track)

      candidates.push({
        trackIndex,
        detectionIndex,
        expectedBox,
        score,
        iou,
        normalizedDistance,
        sizeDifference,
      })
    })
  })

  candidates.sort((left, right) => right.score - left.score)

  const bestByTrack = new Map<number, CandidateMatch>()
  const bestByDetection = new Map<number, CandidateMatch>()
  candidates.forEach((candidate) => {
    if (!bestByTrack.has(candidate.trackIndex)) bestByTrack.set(candidate.trackIndex, candidate)
    if (!bestByDetection.has(candidate.detectionIndex)) bestByDetection.set(candidate.detectionIndex, candidate)
  })

  const usedTracks = new Set<number>()
  const usedDetections = new Set<number>()
  const matches: TrackAssociationMatch[] = []

  const claim = (candidate: CandidateMatch) => {
    if (usedTracks.has(candidate.trackIndex) || usedDetections.has(candidate.detectionIndex)) return false
    usedTracks.add(candidate.trackIndex)
    usedDetections.add(candidate.detectionIndex)
    matches.push(candidate)
    return true
  }

  // Resolve unambiguous mutual-best pairs first. This prevents a merely decent
  // early detection from stealing a track that another detection matches much better.
  candidates.forEach((candidate) => {
    if (
      bestByTrack.get(candidate.trackIndex) === candidate
      && bestByDetection.get(candidate.detectionIndex) === candidate
    ) claim(candidate)
  })

  // Fill remaining pairs globally by quality rather than detector iteration order.
  candidates.forEach(claim)

  return {
    matches,
    unmatchedTrackIndices: tracks.map((_, index) => index).filter((index) => !usedTracks.has(index)),
    unmatchedDetectionIndices: detections.map((_, index) => index).filter((index) => !usedDetections.has(index)),
  }
}
