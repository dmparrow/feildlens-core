export type LabelBox = {
  x: number
  y: number
  width: number
  height: number
}

export type LabelDetection = {
  box: LabelBox
  score: number
}

const WHITE_LUMA = 148
const MAX_CHROMA = 86
const MAX_DETECTIONS = 24

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function overlap(left: LabelBox, right: LabelBox) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

export function boxIou(left: LabelBox, right: LabelBox) {
  return overlap(left, right)
}

export function boxCenterDistance(left: LabelBox, right: LabelBox) {
  const leftX = left.x + left.width / 2
  const leftY = left.y + left.height / 2
  const rightX = right.x + right.width / 2
  const rightY = right.y + right.height / 2
  return Math.hypot(leftX - rightX, leftY - rightY)
}

export function boxSizeDifference(left: LabelBox, right: LabelBox) {
  const leftArea = left.width * left.height
  const rightArea = right.width * right.height
  if (!leftArea || !rightArea) return 1
  return Math.abs(leftArea - rightArea) / Math.max(leftArea, rightArea)
}

export function detectWhiteLabelBoxes(video: HTMLVideoElement): LabelDetection[] {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (!sourceWidth || !sourceHeight) return []

  const scale = Math.min(1, 320 / sourceWidth, 480 / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []

  context.drawImage(video, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)

  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    const luma = red * 0.299 + green * 0.587 + blue * 0.114
    if (luma >= WHITE_LUMA && max - min <= MAX_CHROMA) mask[index] = 1
  }

  const visited = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const detections: LabelDetection[] = []
  const frameArea = width * height

  const enqueue = (next: number, tail: number) => {
    if (next < 0 || next >= mask.length || visited[next] || !mask[next]) return tail
    visited[next] = 1
    queue[tail] = next
    return tail + 1
  }

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue

    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    let count = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      if (x > 0) tail = enqueue(index - 1, tail)
      if (x < width - 1) tail = enqueue(index + 1, tail)
      if (y > 0) tail = enqueue(index - width, tail)
      if (y < height - 1) tail = enqueue(index + width, tail)
    }

    const boxWidth = maxX - minX + 1
    const boxHeight = maxY - minY + 1
    const area = boxWidth * boxHeight
    const normalizedArea = area / frameArea
    const aspect = boxWidth / Math.max(1, boxHeight)
    const fill = count / Math.max(1, area)

    // Keep the detector permissive enough for pallet-distance labels, but drop
    // tiny highlights and near-square bright patches before they become tracks.
    // These geometry limits are deliberately independent of OCR validity.
    if (normalizedArea < 0.00045 || normalizedArea > 0.28) continue
    if (aspect < 1.35 || aspect > 4.8) continue
    if (fill < 0.34) continue
    if (boxWidth < 9 || boxHeight < 5) continue

    const box: LabelBox = {
      x: minX / width,
      y: minY / height,
      width: boxWidth / width,
      height: boxHeight / height,
    }
    const centeredness = 1 - Math.min(1, boxCenterDistance(box, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }))
    detections.push({ box, score: fill * 0.75 + centeredness * 0.25 })
  }

  return detections
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, all) => all.slice(0, index).every((kept) => overlap(candidate.box, kept.box) < 0.42))
    .slice(0, MAX_DETECTIONS)
}

export async function cropDetectedLabel(video: HTMLVideoElement, box: LabelBox): Promise<Blob> {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (!sourceWidth || !sourceHeight) throw new Error('Camera is not ready yet.')

  const marginX = box.width * 0.08
  const marginY = box.height * 0.12
  const x = clamp(box.x - marginX, 0, 1)
  const y = clamp(box.y - marginY, 0, 1)
  const right = clamp(box.x + box.width + marginX, 0, 1)
  const bottom = clamp(box.y + box.height + marginY, 0, 1)
  const cropWidth = Math.max(1, Math.round((right - x) * sourceWidth))
  const cropHeight = Math.max(1, Math.round((bottom - y) * sourceHeight))
  const sourceX = Math.round(x * sourceWidth)
  const sourceY = Math.round(y * sourceHeight)
  const outputScale = Math.min(2.2, 1200 / cropWidth)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cropWidth * outputScale))
  canvas.height = Math.max(1, Math.round(cropHeight * outputScale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not crop the carton label.')

  context.drawImage(
    video,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94))
  if (!blob) throw new Error('Could not crop the carton label.')
  return blob
}
