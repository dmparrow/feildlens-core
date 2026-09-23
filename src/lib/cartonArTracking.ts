import type { LabelBox } from './cartonLabelDetection'

export type Homography = [
  number, number, number,
  number, number, number,
  number, number, number,
]

export type BoxCorrespondence = {
  anchor: LabelBox
  current: LabelBox
}

export type CoverCoordinateSpace = {
  left: number
  top: number
  width: number
  height: number
}

export type CameraDisplayOrientation = 'auto' | 'portrait' | 'landscape'

export type HomographyEstimate = {
  matrix: Homography
  landmarks: number
  residual: number
  mode: 'idle' | 'translation' | 'homography'
}

export const IDENTITY_HOMOGRAPHY: Homography = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]

function center(box: LabelBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint]
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])

  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }

    if (Math.abs(augmented[pivot][column]) < 1e-10) return null
    const swap = augmented[column]
    augmented[column] = augmented[pivot]
    augmented[pivot] = swap

    const divisor = augmented[column][column]
    for (let cursor = column; cursor <= size; cursor += 1) augmented[column][cursor] /= divisor

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      if (Math.abs(factor) < 1e-12) continue
      for (let cursor = column; cursor <= size; cursor += 1) {
        augmented[row][cursor] -= factor * augmented[column][cursor]
      }
    }
  }

  return augmented.map((row) => row[size])
}

function leastSquaresSimilarity(correspondences: BoxCorrespondence[]) {
  if (correspondences.length < 2) return null

  // Fit x' = a*x - b*y + tx, y' = b*x + a*y + ty from label centres.
  // Detection boxes are axis-aligned, so their corners are not reliable planar
  // correspondences under perspective. Centres remain substantially more stable.
  const normal = Array.from({ length: 4 }, () => Array<number>(4).fill(0))
  const rhs = Array<number>(4).fill(0)

  const accumulate = (row: number[], value: number) => {
    for (let left = 0; left < 4; left += 1) {
      rhs[left] += row[left] * value
      for (let right = 0; right < 4; right += 1) normal[left][right] += row[left] * row[right]
    }
  }

  correspondences.forEach(({ anchor, current }) => {
    const from = center(anchor)
    const to = center(current)
    accumulate([from.x, -from.y, 1, 0], to.x)
    accumulate([from.y, from.x, 0, 1], to.y)
  })

  for (let index = 0; index < 4; index += 1) normal[index][index] += 1e-8
  const solved = solveLinearSystem(normal, rhs)
  if (!solved) return null

  const [a, b, tx, ty] = solved
  if (![a, b, tx, ty].every(Number.isFinite)) return null

  return [
    a, -b, tx,
    b, a, ty,
    0, 0, 1,
  ] as Homography
}

function normalizeHomography(matrix: Homography): Homography {
  const divisor = Math.abs(matrix[8]) > 1e-10 ? matrix[8] : 1
  return matrix.map((value) => value / divisor) as Homography
}

function translateExisting(matrix: Homography, dx: number, dy: number): Homography {
  return normalizeHomography([
    matrix[0] + dx * matrix[6], matrix[1] + dx * matrix[7], matrix[2] + dx * matrix[8],
    matrix[3] + dy * matrix[6], matrix[4] + dy * matrix[7], matrix[5] + dy * matrix[8],
    matrix[6], matrix[7], matrix[8],
  ])
}

function blendHomography(previous: Homography, next: Homography, weight: number): Homography {
  const blended = previous.map((value, index) => value * (1 - weight) + next[index] * weight) as Homography
  return normalizeHomography(blended)
}

function similarityScale(matrix: Homography) {
  return Math.hypot(matrix[0], matrix[3])
}

export function projectPoint(matrix: Homography, x: number, y: number) {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8]
  if (Math.abs(denominator) < 1e-8) return { x, y }
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  }
}

export function projectBox(matrix: Homography, box: LabelBox): LabelBox {
  const points = [
    projectPoint(matrix, box.x, box.y),
    projectPoint(matrix, box.x + box.width, box.y),
    projectPoint(matrix, box.x + box.width, box.y + box.height),
    projectPoint(matrix, box.x, box.y + box.height),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  }
}

export function invertHomography(matrix: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = matrix
  const aa = e * i - f * h
  const ab = c * h - b * i
  const ac = b * f - c * e
  const ad = f * g - d * i
  const ae = a * i - c * g
  const af = c * d - a * f
  const ag = d * h - e * g
  const ah = b * g - a * h
  const ai = a * e - b * d
  const determinant = a * aa + b * ad + c * ag
  if (Math.abs(determinant) < 1e-9) return [...IDENTITY_HOMOGRAPHY] as Homography

  return normalizeHomography([
    aa / determinant, ab / determinant, ac / determinant,
    ad / determinant, ae / determinant, af / determinant,
    ag / determinant, ah / determinant, ai / determinant,
  ])
}

function residualForPair(matrix: Homography, pair: BoxCorrespondence) {
  const reference = center(pair.anchor)
  const expected = projectPoint(matrix, reference.x, reference.y)
  const actual = center(pair.current)
  return Math.hypot(expected.x - actual.x, expected.y - actual.y)
}

function estimateResidual(matrix: Homography, correspondences: BoxCorrespondence[]) {
  if (correspondences.length === 0) return 0
  return correspondences.reduce((sum, pair) => sum + residualForPair(matrix, pair), 0) / correspondences.length
}

function robustSimilarity(correspondences: BoxCorrespondence[]) {
  const initial = leastSquaresSimilarity(correspondences)
  if (!initial) return null

  const residuals = correspondences.map((pair) => residualForPair(initial, pair))
  const medianResidual = median(residuals)
  const threshold = Math.max(0.014, Math.min(0.05, medianResidual * 2.5 + 0.006))
  const inliers = correspondences.filter((_, index) => residuals[index] <= threshold)

  if (inliers.length < 2) return null
  const refined = inliers.length === correspondences.length ? initial : leastSquaresSimilarity(inliers)
  if (!refined) return null

  return {
    matrix: refined,
    inliers,
    residual: estimateResidual(refined, inliers),
  }
}

export function estimateSectionHomography(
  correspondences: BoxCorrespondence[],
  previous: Homography,
): HomographyEstimate {
  if (correspondences.length === 0) {
    return { matrix: previous, landmarks: 0, residual: 0, mode: 'idle' }
  }

  if (correspondences.length === 1) {
    const pair = correspondences[0]
    const referenceCenter = center(pair.anchor)
    const predicted = projectPoint(previous, referenceCenter.x, referenceCenter.y)
    const actual = center(pair.current)
    const dx = actual.x - predicted.x
    const dy = actual.y - predicted.y
    const distance = Math.hypot(dx, dy)

    // A single label is useful for translation, but not enough evidence to let
    // one bad association pull the whole pallet overlay across the screen.
    if (distance > 0.14) {
      return { matrix: previous, landmarks: 1, residual: distance, mode: 'idle' }
    }

    const translated = translateExisting(previous, dx, dy)
    return {
      matrix: blendHomography(previous, translated, 0.42),
      landmarks: 1,
      residual: distance,
      mode: 'translation',
    }
  }

  const fitted = robustSimilarity(correspondences)
  if (fitted) {
    const previousScale = similarityScale(previous)
    const nextScale = similarityScale(fitted.matrix)
    const scaleRatio = previousScale > 1e-6 ? nextScale / previousScale : 1

    // Reject abrupt zoom/association jumps. Normal handheld movement between
    // detector frames should not resize the pallet by more than ~30% at once.
    if (
      Number.isFinite(fitted.residual)
      && fitted.residual <= 0.035
      && scaleRatio >= 0.72
      && scaleRatio <= 1.38
    ) {
      const weight = fitted.inliers.length >= 4 ? 0.4 : fitted.inliers.length === 3 ? 0.34 : 0.28
      return {
        matrix: blendHomography(previous, fitted.matrix, weight),
        landmarks: fitted.inliers.length,
        residual: fitted.residual,
        mode: 'homography',
      }
    }
  }

  // If a fit is ambiguous, follow only the consensus screen translation. This
  // preserves tracking through a sweep without allowing a bad label swap to
  // rotate or resize every remembered position.
  const dx: number[] = []
  const dy: number[] = []
  correspondences.forEach((pair) => {
    const referenceCenter = center(pair.anchor)
    const predicted = projectPoint(previous, referenceCenter.x, referenceCenter.y)
    const actual = center(pair.current)
    dx.push(actual.x - predicted.x)
    dy.push(actual.y - predicted.y)
  })
  const medianDx = median(dx)
  const medianDy = median(dy)
  const distance = Math.hypot(medianDx, medianDy)
  if (distance > 0.14) {
    return { matrix: previous, landmarks: correspondences.length, residual: distance, mode: 'idle' }
  }

  const translated = translateExisting(previous, medianDx, medianDy)
  return {
    matrix: blendHomography(previous, translated, 0.36),
    landmarks: correspondences.length,
    residual: distance,
    mode: 'translation',
  }
}

function currentCameraOrientation(): CameraDisplayOrientation {
  if (typeof document === 'undefined') return 'auto'
  const mode = document.documentElement.dataset.cameraOrientation
  return mode === 'portrait' || mode === 'landscape' ? mode : 'auto'
}

function publishCameraDisplaySpace(space: CoverCoordinateSpace, quarterTurn: boolean) {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  style.setProperty('--fieldlens-camera-left', `${space.left}px`)
  style.setProperty('--fieldlens-camera-top', `${space.top}px`)
  style.setProperty('--fieldlens-camera-width', `${space.width}px`)
  style.setProperty('--fieldlens-camera-height', `${space.height}px`)
  style.setProperty('--fieldlens-camera-rotation', quarterTurn ? '90deg' : '0deg')
}

export function getCoverCoordinateSpace(
  videoWidth: number,
  videoHeight: number,
  stageWidth: number,
  stageHeight: number,
  orientation: CameraDisplayOrientation = currentCameraOrientation(),
): CoverCoordinateSpace {
  if (!videoWidth || !videoHeight || !stageWidth || !stageHeight) {
    const empty = { left: 0, top: 0, width: stageWidth, height: stageHeight }
    publishCameraDisplaySpace(empty, false)
    return empty
  }

  const stageOrientation: Exclude<CameraDisplayOrientation, 'auto'> = stageWidth >= stageHeight ? 'landscape' : 'portrait'
  const quarterTurn = orientation !== 'auto' && orientation !== stageOrientation
  const visualWidth = quarterTurn ? videoHeight : videoWidth
  const visualHeight = quarterTurn ? videoWidth : videoHeight
  const scale = Math.max(stageWidth / visualWidth, stageHeight / visualHeight)

  // Keep the CSS box in raw camera coordinates, then rotate the complete plane.
  // The overlay uses this same rectangle, so its normalized detections remain
  // pixel-aligned with the camera after a forced portrait/landscape quarter-turn.
  const width = videoWidth * scale
  const height = videoHeight * scale
  const space = {
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    width,
    height,
  }
  publishCameraDisplaySpace(space, quarterTurn)
  return space
}

export function boxIntersectsVideo(box: LabelBox) {
  return box.x < 1.05 && box.y < 1.05 && box.x + box.width > -0.05 && box.y + box.height > -0.05
}
