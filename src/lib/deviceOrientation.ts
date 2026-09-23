export type DeviceHoldOrientation = 'portrait' | 'landscape'
export type DetectionRotation = 0 | 90 | 270

export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export const DEVICE_HOLD_EVENT = 'fieldlens:device-hold'
export const DETECTION_ROTATION_EVENT = 'fieldlens:detection-rotation'

let detectionRotation: DetectionRotation = 0
let detectionBoxTimer: number | null = null

export function getDeviceHoldOrientation(): DeviceHoldOrientation {
  const type = window.screen.orientation?.type
  if (type?.startsWith('landscape')) return 'landscape'
  if (type?.startsWith('portrait')) return 'portrait'

  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  return width > height ? 'landscape' : 'portrait'
}

export function getDetectionRotation() {
  return detectionRotation
}

export function rotateNormalizedRect(rect: NormalizedRect, rotation: DetectionRotation): NormalizedRect {
  if (rotation === 90) {
    return {
      x: 1 - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    }
  }

  if (rotation === 270) {
    return {
      x: rect.y,
      y: 1 - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    }
  }

  return rect
}

function readPercent(value: string) {
  if (!value.endsWith('%')) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed / 100 : null
}

function writeBoxCoordinate(box: HTMLElement, property: string, value: number) {
  const next = `${value * 100}%`
  if (box.style.getPropertyValue(property) !== next) box.style.setProperty(property, next)
}

function updateDetectionBoxCoordinates() {
  if (detectionRotation === 0) return

  document.querySelectorAll<HTMLElement>('.carton-video-coordinate-space .carton-batch-box').forEach((box) => {
    // React owns the raw detector coordinates in left/top/width/height. Keep
    // those values untouched and publish corrected coordinates through custom
    // properties so tracking/OCR continue to operate in camera space.
    const x = readPercent(box.style.left)
    const y = readPercent(box.style.top)
    const width = readPercent(box.style.width)
    const height = readPercent(box.style.height)
    if (x === null || y === null || width === null || height === null) return

    const rotated = rotateNormalizedRect({ x, y, width, height }, detectionRotation)
    writeBoxCoordinate(box, '--fieldlens-box-left', rotated.x)
    writeBoxCoordinate(box, '--fieldlens-box-top', rotated.y)
    writeBoxCoordinate(box, '--fieldlens-box-width', rotated.width)
    writeBoxCoordinate(box, '--fieldlens-box-height', rotated.height)
  })
}

function clearDetectionBoxCoordinates() {
  document.querySelectorAll<HTMLElement>('.carton-video-coordinate-space .carton-batch-box').forEach((box) => {
    box.style.removeProperty('--fieldlens-box-left')
    box.style.removeProperty('--fieldlens-box-top')
    box.style.removeProperty('--fieldlens-box-width')
    box.style.removeProperty('--fieldlens-box-height')
  })
}

function syncDetectionBoxTracking() {
  if (detectionRotation === 0) {
    if (detectionBoxTimer !== null) {
      window.clearInterval(detectionBoxTimer)
      detectionBoxTimer = null
    }
    clearDetectionBoxCoordinates()
    return
  }

  updateDetectionBoxCoordinates()
  if (detectionBoxTimer === null) {
    // Detector tracks update every ~360 ms. Sampling the rendered coordinates
    // a little faster keeps the corrected boxes smooth without a DOM observer
    // feedback loop.
    detectionBoxTimer = window.setInterval(updateDetectionBoxCoordinates, 120)
  }
}

function updateDetectionButtons() {
  document.querySelectorAll<HTMLButtonElement>('.fieldlens-detection-rotate').forEach((button) => {
    const nextRotation = String(detectionRotation)
    const nextTitle = detectionRotation === 0
      ? 'Rotate detection positions if phone rotation lock is on'
      : `Detection positions corrected ${detectionRotation}°. Tap to rotate again.`
    const nextValue = detectionRotation === 0 ? 'AUTO' : `${detectionRotation}°`

    if (button.dataset.rotation !== nextRotation) button.dataset.rotation = nextRotation
    if (button.title !== nextTitle) button.title = nextTitle
    if (button.getAttribute('aria-label') !== nextTitle) button.setAttribute('aria-label', nextTitle)

    const value = button.querySelector<HTMLElement>('[data-detection-rotation-value]')
    if (value && value.textContent !== nextValue) value.textContent = nextValue
  })
}

function publishDetectionRotation() {
  const nextRotation = String(detectionRotation)
  if (document.documentElement.dataset.detectionRotation !== nextRotation) {
    document.documentElement.dataset.detectionRotation = nextRotation
  }
  updateDetectionButtons()
  syncDetectionBoxTracking()
  window.dispatchEvent(new CustomEvent<DetectionRotation>(DETECTION_ROTATION_EVENT, { detail: detectionRotation }))
}

export function rotateDetectionOverlay() {
  detectionRotation = detectionRotation === 0 ? 90 : detectionRotation === 90 ? 270 : 0
  publishDetectionRotation()
  refreshCameraGeometry()
  return detectionRotation
}

export function resetDetectionRotation() {
  if (detectionRotation === 0) return
  detectionRotation = 0
  publishDetectionRotation()
}

function publishDeviceHoldOrientation() {
  const orientation = getDeviceHoldOrientation()
  if (document.documentElement.dataset.deviceHold !== orientation) {
    document.documentElement.dataset.deviceHold = orientation
  }
  window.dispatchEvent(new CustomEvent<DeviceHoldOrientation>(DEVICE_HOLD_EVENT, { detail: orientation }))
}

function refreshCameraGeometry() {
  // iOS can announce a hold change before the video element exposes its new
  // intrinsic dimensions. LabelCheckView recalculates its cover rectangle on
  // resize; repeat that signal after the browser settles without touching the
  // camera constraints, preview transform, or field of view.
  window.requestAnimationFrame(() => {
    updateDetectionBoxCoordinates()
    window.dispatchEvent(new Event('resize'))
  })
  window.setTimeout(() => {
    updateDetectionBoxCoordinates()
    window.dispatchEvent(new Event('resize'))
  }, 120)
  window.setTimeout(() => {
    updateDetectionBoxCoordinates()
    window.dispatchEvent(new Event('resize'))
  }, 320)
  window.setTimeout(() => {
    updateDetectionBoxCoordinates()
    window.dispatchEvent(new Event('resize'))
  }, 650)
}

function attachCameraBridges() {
  const attachedVideos = new WeakSet<HTMLVideoElement>()
  let attachQueued = false

  const attach = () => {
    let changed = false

    document.querySelectorAll('video').forEach((video) => {
      if (attachedVideos.has(video)) return
      attachedVideos.add(video)
      video.addEventListener('resize', refreshCameraGeometry)
      changed = true
    })

    document.querySelectorAll<HTMLElement>('.carton-batch-camera').forEach((camera) => {
      if (camera.querySelector('.fieldlens-detection-rotate')) return

      const button = document.createElement('button')
      button.className = 'fieldlens-detection-rotate'
      button.type = 'button'
      button.innerHTML = '<span aria-hidden="true">↻</span><small data-detection-rotation-value>AUTO</small>'
      button.addEventListener('click', rotateDetectionOverlay)
      camera.appendChild(button)
      changed = true
    })

    if (changed) {
      updateDetectionButtons()
      updateDetectionBoxCoordinates()
    }
  }

  const scheduleAttach = () => {
    if (attachQueued) return
    attachQueued = true
    window.requestAnimationFrame(() => {
      attachQueued = false
      attach()
    })
  }

  attach()
  const observer = new MutationObserver(scheduleAttach)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  return () => observer.disconnect()
}

export function startDeviceHoldTracking() {
  const handlePhysicalOrientationChange = () => {
    // When the browser really rotates, its own camera/display geometry becomes
    // authoritative again. Manual correction is only for orientation-lock cases.
    resetDetectionRotation()
    publishDeviceHoldOrientation()
    refreshCameraGeometry()
  }

  const handleViewportChange = () => {
    publishDeviceHoldOrientation()
    refreshCameraGeometry()
  }

  publishDeviceHoldOrientation()
  publishDetectionRotation()
  const detachCameraBridges = attachCameraBridges()

  window.addEventListener('orientationchange', handlePhysicalOrientationChange)
  window.screen.orientation?.addEventListener?.('change', handlePhysicalOrientationChange)
  window.visualViewport?.addEventListener('resize', handleViewportChange)

  return () => {
    detachCameraBridges()
    if (detectionBoxTimer !== null) {
      window.clearInterval(detectionBoxTimer)
      detectionBoxTimer = null
    }
    window.removeEventListener('orientationchange', handlePhysicalOrientationChange)
    window.screen.orientation?.removeEventListener?.('change', handlePhysicalOrientationChange)
    window.visualViewport?.removeEventListener('resize', handleViewportChange)
  }
}
