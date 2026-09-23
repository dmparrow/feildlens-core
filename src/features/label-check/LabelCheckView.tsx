import { AlertTriangle, ArrowDown, CheckCircle2, Pause, Play, RefreshCw, RotateCcw, ScanLine, Settings, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  boxIntersectsVideo,
  estimateSectionHomography,
  getCoverCoordinateSpace,
  IDENTITY_HOMOGRAPHY,
  invertHomography,
  projectBox,
  type CoverCoordinateSpace,
  type Homography,
} from '../../lib/cartonArTracking'
import {
  finishPalletLabelSession,
  savePalletLabelScans,
  startPalletLabelSession,
} from '../../lib/database'
import {
  createCartonLabelScan,
  MIN_RECOGNIZED_LABEL_FIELDS,
  summarizeCartonLabels,
  type CartonLabelScan,
  type CartonLabelSection,
} from '../../lib/cartonLabelConformity'
import {
  boxCenterDistance,
  boxIou,
  boxSizeDifference,
  cropDetectedLabel,
  detectWhiteLabelBoxes,
  type LabelBox,
  type LabelDetection,
} from '../../lib/cartonLabelDetection'
import { associateLabelDetections } from '../../lib/cartonTrackAssociation'
import {
  hasCartonLabelIdentity,
  LABEL_FIELD_KEYS,
  LABEL_FIELD_LABELS,
  recognizeLabel,
  warmLabelOcr,
  type LabelFields,
} from '../../lib/labelOcr'
import { CartonConfigPicker } from './CartonConfigPicker'
import './LabelCheckView.css'
import './CartonLabelScan.css'

type Step = 'setup' | 'scan' | 'result'
type TrackStatus = 'tracking' | 'queued' | 'reading' | 'accepted' | 'retry' | 'ignored'

type LabelTrack = {
  id: string
  box: LabelBox
  anchorBox: LabelBox
  stableFrames: number
  missedFrames: number
  status: TrackStatus
  retryAfter: number
  recognizedFields?: number
  memoryId?: string
}

type RememberedAnchor = {
  id: string
  anchorBox: LabelBox
  labelNumber: number
}

type OcrQueueItem = {
  trackId: string
  anchorBox: LabelBox
  section: CartonLabelSection
  sessionId: string
  image: Blob
}

const CARTON_COUNT_STORAGE_KEY = 'fieldlens-ean-carton-count'
const DEFAULT_CARTON_COUNT = 160
const DETECTION_INTERVAL_MS = 360
const MIN_STABLE_FRAMES = 2
const MAX_MISSED_FRAMES = 4
const OCR_RETRY_DELAY_MS = 1600
const OCR_CONCURRENCY = 2
const MAX_OCR_QUEUE = 8
const STEP_INDEX: Record<Step, number> = {
  setup: 0,
  scan: 1,
  result: 2,
}

function loadCartonCount() {
  try {
    const stored = Number(localStorage.getItem(CARTON_COUNT_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= 1 && stored <= 500 ? Math.round(stored) : DEFAULT_CARTON_COUNT
  } catch {
    return DEFAULT_CARTON_COUNT
  }
}

function saveCartonCount(count: number) {
  try {
    localStorage.setItem(CARTON_COUNT_STORAGE_KEY, String(count))
  } catch {
    // The picker remains usable if browser storage is unavailable.
  }
}

function visibleFields(fields?: LabelFields) {
  if (!fields) return []
  return LABEL_FIELD_KEYS
    .filter((field) => fields[field].trim())
    .map((field) => ({ field, label: LABEL_FIELD_LABELS[field], value: fields[field] }))
}

function sectionKey(section: CartonLabelSection) {
  return `${section.face}-${section.half}`
}

function sectionLabel(section: CartonLabelSection) {
  return `Face ${section.face} · ${section.half === 'top' ? 'Top half' : 'Bottom half'}`
}

function blendBox(previous: LabelBox, next: LabelBox): LabelBox {
  const nextWeight = 0.46
  const previousWeight = 1 - nextWeight
  return {
    x: previous.x * previousWeight + next.x * nextWeight,
    y: previous.y * previousWeight + next.y * nextWeight,
    width: previous.width * previousWeight + next.width * nextWeight,
    height: previous.height * previousWeight + next.height * nextWeight,
  }
}

function samePhysicalAnchor(left: LabelBox, right: LabelBox) {
  const sizeDifference = boxSizeDifference(left, right)
  if (sizeDifference > 0.46) return false
  const iou = boxIou(left, right)
  if (iou >= 0.34) return true
  const distance = boxCenterDistance(left, right)
  const scale = Math.max(0.018, Math.min(0.052, Math.min(left.width, right.width) * 0.32))
  return distance <= scale
}

export function LabelCheckView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const labelsRef = useRef<CartonLabelScan[]>([])
  const sessionIdRef = useRef('')
  const tracksRef = useRef<LabelTrack[]>([])
  const trackCounterRef = useRef(0)
  const queueRef = useRef<OcrQueueItem[]>([])
  const activeOcrWorkersRef = useRef(0)
  const activeTrackIdsRef = useRef(new Set<string>())
  const acceptedAnchorsRef = useRef(new Map<string, RememberedAnchor>())
  const homographyRef = useRef<Homography>([...IDENTITY_HOMOGRAPHY])
  const sectionRef = useRef<CartonLabelSection>({ face: 1, half: 'top' })
  const sectionStartCountRef = useRef(0)
  const targetCountRef = useRef(loadCartonCount())
  const finishedRef = useRef(false)

  const [step, setStep] = useState<Step>('setup')
  const [targetCount, setTargetCount] = useState(loadCartonCount)
  const [labels, setLabels] = useState<CartonLabelScan[]>([])
  const [tracks, setTracks] = useState<LabelTrack[]>([])
  const [acceptedAnchors, setAcceptedAnchors] = useState<RememberedAnchor[]>([])
  const [homography, setHomography] = useState<Homography>([...IDENTITY_HOMOGRAPHY])
  const [anchorLandmarks, setAnchorLandmarks] = useState(0)
  const [anchorMode, setAnchorMode] = useState<'idle' | 'translation' | 'homography'>('idle')
  const [videoSpace, setVideoSpace] = useState<CoverCoordinateSpace>({ left: 0, top: 0, width: 0, height: 0 })
  const [section, setSection] = useState<CartonLabelSection>({ face: 1, half: 'top' })
  const [sectionStartCount, setSectionStartCount] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [scanPaused, setScanPaused] = useState(false)
  const [queueCount, setQueueCount] = useState(0)
  const [activeOcrCount, setActiveOcrCount] = useState(0)
  const [, setProcessingTrackId] = useState('')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Preparing OCR')
  const [error, setError] = useState('')
  const [lastRead, setLastRead] = useState<CartonLabelScan | null>(null)
  const [arEnabled, setArEnabled] = useState(true)

  const summary = useMemo(() => summarizeCartonLabels(labels), [labels])
  const currentStepIndex = STEP_INDEX[step]
  const lastFields = visibleFields(lastRead?.fields)
  const sectionRead = labels.length - sectionStartCount
  const sectionGuide = Math.max(1, Math.round(targetCount / 4))
  const visibleTracks = tracks.filter((track) => track.missedFrames === 0)
  const retryTracks = visibleTracks.filter((track) => track.status === 'retry').length
  const ignoredTracks = visibleTracks.filter((track) => track.status === 'ignored').length
  const visibleMemoryIds = new Set(visibleTracks.map((track) => track.memoryId).filter((value): value is string => Boolean(value)))
  const rememberedBoxes = acceptedAnchors
    .filter((anchor) => !visibleMemoryIds.has(anchor.id))
    .map((anchor) => ({ ...anchor, box: projectBox(homography, anchor.anchorBox) }))
    .filter((anchor) => boxIntersectsVideo(anchor.box))

  const syncTracks = (next: LabelTrack[]) => {
    tracksRef.current = next
    setTracks(next)
  }

  const syncAcceptedAnchors = () => {
    setAcceptedAnchors([...acceptedAnchorsRef.current.values()])
  }

  const updateTrack = (trackId: string, update: (track: LabelTrack) => LabelTrack) => {
    const next = tracksRef.current.map((track) => track.id === trackId ? update(track) : track)
    syncTracks(next)
  }

  const updateOcrActivity = () => {
    setActiveOcrCount(activeOcrWorkersRef.current)
    setProcessingTrackId(activeTrackIdsRef.current.values().next().value ?? '')
  }

  const findRememberedAnchor = (anchorBox: LabelBox) => {
    return [...acceptedAnchorsRef.current.values()]
      .filter((anchor) => samePhysicalAnchor(anchor.anchorBox, anchorBox))
      .sort((left, right) => {
        const leftDistance = boxCenterDistance(left.anchorBox, anchorBox)
        const rightDistance = boxCenterDistance(right.anchorBox, anchorBox)
        if (Math.abs(leftDistance - rightDistance) > 0.002) return leftDistance - rightDistance
        return boxSizeDifference(left.anchorBox, anchorBox) - boxSizeDifference(right.anchorBox, anchorBox)
      })[0]
  }

  const finishPallet = (nextLabels: CartonLabelScan[]) => {
    if (finishedRef.current) return
    finishedRef.current = true
    queueRef.current = []
    setQueueCount(0)
    const nextSummary = summarizeCartonLabels(nextLabels)
    if (sessionIdRef.current) {
      void finishPalletLabelSession(sessionIdRef.current, {
        conforms: nextSummary.conforms,
        resultStatus: nextSummary.status,
        mismatchCartons: nextSummary.mismatchCartons,
        majorityFields: nextSummary.majorityFields,
      }).catch(() => undefined)
    }
    setStep('result')
  }

  const processOcrItem = async (item: OcrQueueItem) => {
    activeTrackIdsRef.current.add(item.trackId)
    updateOcrActivity()

    try {
      const track = tracksRef.current.find((candidate) => candidate.id === item.trackId)
      if (!track || track.status === 'accepted' || track.status === 'ignored') return

      updateTrack(item.trackId, (candidate) => ({ ...candidate, status: 'reading' }))
      setProcessingTrackId(item.trackId)
      setProgress(0)
      setProgressLabel('Reading detected label')

      const ocr = await recognizeLabel(item.image, (nextProgress, status) => {
        setProcessingTrackId(item.trackId)
        setProgress(nextProgress)
        setProgressLabel(status)
      })

      if (
        finishedRef.current
        || item.sessionId !== sessionIdRef.current
        || sectionKey(item.section) !== sectionKey(sectionRef.current)
      ) return

      const scan = createCartonLabelScan(ocr, item.section, item.trackId)

      if (!hasCartonLabelIdentity(ocr)) {
        updateTrack(item.trackId, (candidate) => ({
          ...candidate,
          status: 'ignored',
          stableFrames: 0,
          retryAfter: Number.POSITIVE_INFINITY,
          recognizedFields: 0,
        }))
        setProgress(100)
        setProgressLabel('Ignored · no valid PPIN or grower number')
        return
      }

      setLastRead(scan)

      if (scan.recognizedFields < MIN_RECOGNIZED_LABEL_FIELDS) {
        updateTrack(item.trackId, (candidate) => ({
          ...candidate,
          status: 'retry',
          stableFrames: 0,
          retryAfter: Date.now() + OCR_RETRY_DELAY_MS,
          recognizedFields: scan.recognizedFields,
        }))
        return
      }

      if (labelsRef.current.length >= targetCountRef.current) return

      const currentTrack = tracksRef.current.find((candidate) => candidate.id === item.trackId)
      const anchorBox = currentTrack?.anchorBox ?? item.anchorBox
      const rememberedDuplicate = findRememberedAnchor(anchorBox)
      if (rememberedDuplicate && rememberedDuplicate.id !== item.trackId) {
        updateTrack(item.trackId, (candidate) => ({
          ...candidate,
          status: 'accepted',
          memoryId: rememberedDuplicate.id,
          recognizedFields: scan.recognizedFields,
        }))
        setProgress(100)
        setProgressLabel('Already counted · AR position memory')
        return
      }

      updateTrack(item.trackId, (candidate) => ({
        ...candidate,
        status: 'accepted',
        memoryId: item.trackId,
        recognizedFields: scan.recognizedFields,
      }))

      const nextLabels = [...labelsRef.current, scan]
      acceptedAnchorsRef.current.set(item.trackId, {
        id: item.trackId,
        anchorBox,
        labelNumber: nextLabels.length,
      })
      syncAcceptedAnchors()
      labelsRef.current = nextLabels
      setLabels(nextLabels)
      setProgress(100)
      setProgressLabel(`${scan.recognizedFields} validated fields accepted`)
      navigator.vibrate?.(45)

      if (sessionIdRef.current) {
        void savePalletLabelScans(sessionIdRef.current, nextLabels).catch(() => {
          setError('Local persistence failed. This pallet remains available only in the current screen.')
        })
      }

      if (nextLabels.length >= targetCountRef.current) finishPallet(nextLabels)
    } catch (readError) {
      if (item.sessionId === sessionIdRef.current && sectionKey(item.section) === sectionKey(sectionRef.current)) {
        updateTrack(item.trackId, (candidate) => ({
          ...candidate,
          status: 'retry',
          stableFrames: 0,
          retryAfter: Date.now() + OCR_RETRY_DELAY_MS,
        }))
        setError(readError instanceof Error ? readError.message : 'A detected carton label could not be read.')
      }
    } finally {
      activeTrackIdsRef.current.delete(item.trackId)
      activeOcrWorkersRef.current = Math.max(0, activeOcrWorkersRef.current - 1)
      updateOcrActivity()
      setQueueCount(queueRef.current.length)
      pumpOcrQueue()
    }
  }

  const pumpOcrQueue = () => {
    if (finishedRef.current) return

    while (activeOcrWorkersRef.current < OCR_CONCURRENCY && queueRef.current.length > 0) {
      const item = queueRef.current.shift()
      if (!item) break
      activeOcrWorkersRef.current += 1
      setQueueCount(queueRef.current.length)
      void processOcrItem(item)
    }
    updateOcrActivity()
  }

  const captureAndQueue = async (track: LabelTrack) => {
    const video = videoRef.current
    if (!video || track.status !== 'tracking' && track.status !== 'retry') return
    if (queueRef.current.length + activeOcrWorkersRef.current >= MAX_OCR_QUEUE) return
    const currentSection = sectionRef.current
    const expectedSectionKey = sectionKey(currentSection)
    const expectedSessionId = sessionIdRef.current

    updateTrack(track.id, (candidate) => ({ ...candidate, status: 'queued' }))

    try {
      const image = await cropDetectedLabel(video, track.box)
      if (
        sectionKey(sectionRef.current) !== expectedSectionKey
        || sessionIdRef.current !== expectedSessionId
        || finishedRef.current
      ) return
      queueRef.current.push({
        trackId: track.id,
        anchorBox: track.anchorBox,
        section: currentSection,
        sessionId: expectedSessionId,
        image,
      })
      setQueueCount(queueRef.current.length)
      pumpOcrQueue()
    } catch {
      updateTrack(track.id, (candidate) => ({
        ...candidate,
        status: 'retry',
        stableFrames: 0,
        retryAfter: Date.now() + OCR_RETRY_DELAY_MS,
      }))
    }
  }

  const reconcileDetections = (detections: LabelDetection[]) => {
    const previous = tracksRef.current
    const association = associateLabelDetections(previous, detections, homographyRef.current)
    const matchedTracks: LabelTrack[] = []
    const correspondences: { anchor: LabelBox; current: LabelBox }[] = []

    association.matches.forEach((match) => {
      const previousTrack = previous[match.trackIndex]
      const detection = detections[match.detectionIndex]
      const motion = boxCenterDistance(match.expectedBox, detection.box)
      const stableMotion = Math.max(
        0.018,
        Math.min(0.04, Math.hypot(match.expectedBox.width, match.expectedBox.height) * 0.35),
      )

      matchedTracks.push({
        ...previousTrack,
        box: blendBox(previousTrack.box, detection.box),
        stableFrames: motion <= stableMotion ? previousTrack.stableFrames + 1 : 1,
        missedFrames: 0,
      })

      const reliableForPlane =
        previousTrack.status !== 'ignored'
        && previousTrack.stableFrames >= MIN_STABLE_FRAMES
        && (match.iou >= 0.2 || match.normalizedDistance <= 0.55)

      if (reliableForPlane) {
        correspondences.push({ anchor: previousTrack.anchorBox, current: detection.box })
      }
    })

    const estimate = estimateSectionHomography(correspondences, homographyRef.current)
    homographyRef.current = estimate.matrix
    setHomography(estimate.matrix)
    setAnchorLandmarks(estimate.landmarks)
    setAnchorMode(estimate.mode)
    const inverse = invertHomography(estimate.matrix)

    const nextTracks = [...matchedTracks]

    association.unmatchedDetectionIndices.forEach((detectionIndex) => {
      const detection = detections[detectionIndex]
      trackCounterRef.current += 1
      const anchorBox = projectBox(inverse, detection.box)
      const remembered = findRememberedAnchor(anchorBox)
      nextTracks.push({
        id: `label-${trackCounterRef.current}`,
        box: detection.box,
        anchorBox,
        stableFrames: 1,
        missedFrames: 0,
        status: remembered ? 'accepted' : 'tracking',
        retryAfter: 0,
        memoryId: remembered?.id,
      })
    })

    association.unmatchedTrackIndices.forEach((index) => {
      const track = previous[index]
      const missedFrames = track.missedFrames + 1
      if (missedFrames <= MAX_MISSED_FRAMES) nextTracks.push({ ...track, missedFrames })
    })

    syncTracks(nextTracks)

    const availableQueueSlots = Math.max(0, MAX_OCR_QUEUE - queueRef.current.length - activeOcrWorkersRef.current)
    nextTracks
      .filter((track) =>
        track.missedFrames === 0
        && track.stableFrames >= MIN_STABLE_FRAMES
        && (track.status === 'tracking' || track.status === 'retry')
        && Date.now() >= track.retryAfter,
      )
      .sort((left, right) => right.box.width * right.box.height - left.box.width * left.box.height)
      .slice(0, Math.min(4, availableQueueSlots))
      .forEach((track) => void captureAndQueue(track))
  }

  useEffect(() => {
    if (step !== 'scan') return
    void warmLabelOcr().catch(() => undefined)
  }, [step])

  useEffect(() => {
    if (step !== 'scan') return
    let disposed = false

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }

    const startCamera = async () => {
      stopCamera()
      setCameraReady(false)
      setCameraError('')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })

      if (disposed) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      if (!disposed) setCameraReady(true)
    }

    void startCamera().catch((cameraStartError: unknown) => {
      if (!disposed) {
        setCameraError(cameraStartError instanceof Error ? cameraStartError.message : 'Camera access failed.')
        setCameraReady(false)
      }
    })

    return () => {
      disposed = true
      stopCamera()
    }
  }, [retryKey, step])

  useEffect(() => {
    if (step !== 'scan' || !cameraReady) return
    const video = videoRef.current
    const stage = stageRef.current
    if (!video || !stage) return

    const updateSpace = () => {
      setVideoSpace(getCoverCoordinateSpace(
        video.videoWidth,
        video.videoHeight,
        stage.clientWidth,
        stage.clientHeight,
      ))
    }

    updateSpace()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSpace)
    observer?.observe(stage)
    video.addEventListener('loadedmetadata', updateSpace)
    window.addEventListener('resize', updateSpace)
    window.addEventListener('orientationchange', updateSpace)

    return () => {
      observer?.disconnect()
      video.removeEventListener('loadedmetadata', updateSpace)
      window.removeEventListener('resize', updateSpace)
      window.removeEventListener('orientationchange', updateSpace)
    }
  }, [cameraReady, step])

  useEffect(() => {
    if (step !== 'scan' || !cameraReady || scanPaused || finishedRef.current) return

    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      reconcileDetections(detectWhiteLabelBoxes(video))
    }, DETECTION_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [cameraReady, scanPaused, step])

  const changeCartonCount = (count: number) => {
    const nextCount = Math.max(0, Math.min(500, Math.round(count)))
    setTargetCount(nextCount)
    targetCountRef.current = nextCount
    if (nextCount > 0) saveCartonCount(nextCount)
  }

  const clearSectionTracking = () => {
    queueRef.current = []
    setQueueCount(0)
    syncTracks([])
    trackCounterRef.current = 0
    acceptedAnchorsRef.current.clear()
    syncAcceptedAnchors()
    const identity = [...IDENTITY_HOMOGRAPHY] as Homography
    homographyRef.current = identity
    setHomography(identity)
    setAnchorLandmarks(0)
    setAnchorMode('idle')
    setProgress(0)
    setProgressLabel('Preparing OCR')
    setError('')
  }

  const startSession = async () => {
    if (!Number.isFinite(targetCount) || targetCount < 1 || targetCount > 500) {
      setError('Enter a carton count between 1 and 500.')
      return
    }

    const safeCount = Math.round(targetCount)
    setError('')
    setLastRead(null)
    setTargetCount(safeCount)
    targetCountRef.current = safeCount
    saveCartonCount(safeCount)
    finishedRef.current = false
    labelsRef.current = []
    setLabels([])
    sectionRef.current = { face: 1, half: 'top' }
    setSection(sectionRef.current)
    sectionStartCountRef.current = 0
    setSectionStartCount(0)
    setScanPaused(false)
    clearSectionTracking()
    void warmLabelOcr().catch(() => undefined)

    try {
      const session = await startPalletLabelSession(safeCount)
      sessionIdRef.current = session.id
    } catch {
      setError('Could not create the local pallet record. Check browser storage and try again.')
      return
    }

    setStep('scan')
    setRetryKey((value) => value + 1)
  }

  const reset = () => {
    finishedRef.current = false
    labelsRef.current = []
    sessionIdRef.current = ''
    queueRef.current = []
    setQueueCount(0)
    setLabels([])
    setLastRead(null)
    setCameraReady(false)
    setCameraError('')
    setScanPaused(false)
    setProcessingTrackId('')
    sectionRef.current = { face: 1, half: 'top' }
    setSection(sectionRef.current)
    sectionStartCountRef.current = 0
    setSectionStartCount(0)
    clearSectionTracking()
    setStep('setup')
  }

  const undoLastScan = () => {
    if (labelsRef.current.length === 0 || activeOcrCount > 0 || queueCount > 0) return
    const removed = labelsRef.current.at(-1)
    const next = labelsRef.current.slice(0, -1)
    labelsRef.current = next
    setLabels(next)
    setLastRead(next.at(-1) ?? null)

    if (removed?.trackId) {
      acceptedAnchorsRef.current.delete(removed.trackId)
      syncAcceptedAnchors()
      updateTrack(removed.trackId, (track) => ({
        ...track,
        status: 'tracking',
        memoryId: undefined,
        recognizedFields: undefined,
        stableFrames: 0,
        retryAfter: Date.now() + 500,
      }))
    }

    if (sessionIdRef.current) void savePalletLabelScans(sessionIdRef.current, next).catch(() => undefined)
    setError('Last accepted carton removed.')
  }

  const nextSection = () => {
    if (activeOcrCount > 0 || queueCount > 0) return
    const nextSectionValue: CartonLabelSection = section.half === 'top'
      ? { face: section.face, half: 'bottom' }
      : { face: section.face + 1, half: 'top' }

    sectionRef.current = nextSectionValue
    setSection(nextSectionValue)
    sectionStartCountRef.current = labelsRef.current.length
    setSectionStartCount(labelsRef.current.length)
    clearSectionTracking()
    setScanPaused(false)
  }

  const mismatchIssues = summary.issues.filter((issue) => issue.status === 'mismatch')
  const unreadIssues = summary.issues.filter((issue) => issue.status === 'unread')
  const anchorStatus = anchorMode === 'homography'
    ? `AR plane locked · ${anchorLandmarks} anchors`
    : anchorMode === 'translation'
      ? `AR following · ${anchorLandmarks} anchor${anchorLandmarks === 1 ? '' : 's'}`
      : acceptedAnchors.length > 0
        ? 'AR position memory coasting'
        : 'AR plane acquiring'

  return (
    <section className="workspace-view label-check-view carton-label-view" aria-labelledby="label-check-title">
      <header className="view-heading label-check-heading">
        <div>
          <span className="eyebrow">PALLET LABEL VERIFICATION</span>
          <h1 id="label-check-title">Pallet label check</h1>
          <p>Batch OCR · sweep each pallet section and compare printed key/value fields</p>
        </div>
        <div className="view-actions">
          <button className="quiet-button" type="button" onClick={onOpenSettings}><Settings size={16} /> Integrations</button>
          {step !== 'setup' && <button className="quiet-button" type="button" onClick={reset}><RefreshCw size={16} /> New pallet</button>}
        </div>
      </header>

      <ol className="label-stepper label-stepper-three" aria-label="Pallet label check progress">
        {['Setup', 'Sweep sections', 'Conformity'].map((label, index) => (
          <li className={currentStepIndex === index ? 'active' : currentStepIndex > index ? 'done' : ''} key={label}><span>{index + 1}</span> {label}</li>
        ))}
      </ol>

      {step === 'setup' && (
        <div className="ean-setup-card">
          <ScanLine size={38} />
          <h2>Start pallet check</h2>
          <p>Scan the top half, then the bottom half, move around the pallet and repeat. White labels are detected and OCR'd in batches while you sweep.</p>
          <CartonConfigPicker value={targetCount} onChange={changeCartonCount} onStart={() => void startSession()} />
          <label className="ean-ar-toggle">
            <input type="checkbox" checked={arEnabled} onChange={(event) => setArEnabled(event.target.checked)} />
            <span><strong>AR assist</strong><small>Tracks accepted carton positions across each pallet-half sweep. OCR and storage stay local-first.</small></span>
          </label>
          {error && <div className="label-error"><AlertTriangle /> <span>{error}</span></div>}
        </div>
      )}

      {step === 'scan' && (
        <div className="label-scan-panel carton-label-scan-panel">
          <div className="carton-section-head">
            <div>
              <span>Current sweep</span>
              <strong>{sectionLabel(section)}</strong>
              <small>Sweep slowly with some overlap between views so AR can keep the pallet face anchored.</small>
            </div>
            <button className="quiet-button" type="button" onClick={() => setScanPaused((value) => !value)}>
              {scanPaused ? <Play size={15} /> : <Pause size={15} />} {scanPaused ? 'Resume' : 'Pause'}
            </button>
          </div>

          <div className="ean-session-strip carton-batch-stats">
            <div><span>Pallet</span><strong>{labels.length} / {targetCount}</strong></div>
            <div><span>This section</span><strong>{sectionRead} / ~{sectionGuide}</strong></div>
            <div><span>Visible labels</span><strong>{visibleTracks.length}</strong></div>
            <div><span>OCR queue</span><strong>{queueCount + activeOcrCount}</strong></div>
          </div>
          <div className="ean-progress-track"><span style={{ width: `${Math.min(100, (labels.length / targetCount) * 100)}%` }} /></div>

          <div ref={stageRef} className={`label-camera-stage carton-label-camera carton-batch-camera ${!cameraReady ? 'scanner-starting' : ''}`}>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Pallet carton label batch OCR camera" />
            <div className="label-camera-shade" />

            {arEnabled && videoSpace.width > 0 && (
              <div
                className="carton-video-coordinate-space"
                style={{
                  left: `${videoSpace.left}px`,
                  top: `${videoSpace.top}px`,
                  width: `${videoSpace.width}px`,
                  height: `${videoSpace.height}px`,
                }}
              >
                {rememberedBoxes.map((anchor) => (
                  <div
                    className="carton-batch-box accepted remembered"
                    key={`remembered-${anchor.id}`}
                    style={{
                      left: `${anchor.box.x * 100}%`,
                      top: `${anchor.box.y * 100}%`,
                      width: `${anchor.box.width * 100}%`,
                      height: `${anchor.box.height * 100}%`,
                    }}
                  >
                    <span>✓</span>
                  </div>
                ))}

                {visibleTracks.map((track) => (
                  <div
                    className={`carton-batch-box ${track.status}`}
                    key={track.id}
                    style={{
                      left: `${track.box.x * 100}%`,
                      top: `${track.box.y * 100}%`,
                      width: `${track.box.width * 100}%`,
                      height: `${track.box.height * 100}%`,
                    }}
                  >
                    <span>{track.status === 'accepted' ? '✓' : track.status === 'ignored' ? '–' : track.status === 'retry' ? '?' : track.status === 'reading' ? 'OCR' : track.status === 'queued' ? '…' : ''}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="carton-batch-instruction">
              <span>{sectionLabel(section)}</span>
              <strong>{scanPaused ? 'Sweep paused' : 'Sweep across the white labels'}</strong>
              <small>Green = accepted, amber = another pass, grey = not a PPIN/grower label.</small>
              {arEnabled && <em>{anchorStatus}</em>}
            </div>

            {activeOcrCount > 0 && (
              <div className="carton-batch-ocr-status" aria-live="polite">
                <strong>{activeOcrCount} OCR worker{activeOcrCount === 1 ? '' : 's'} · {progress}%</strong>
                <span>{progressLabel}</span>
                <div className="label-progress"><span style={{ width: `${progress}%` }} /></div>
              </div>
            )}

            {arEnabled && lastFields.length > 0 && (
              <div className="carton-live-fields carton-batch-last-fields" aria-live="polite">
                <span>Last accepted · {lastRead?.recognizedFields} fields</span>
                {lastFields.slice(0, 4).map(({ field, label, value }) => <div key={field}><b>{label}</b><strong>{value}</strong></div>)}
              </div>
            )}
          </div>

          <div className="carton-section-actions">
            <div>
              <span>{retryTracks > 0 ? `${retryTracks} visible label${retryTracks === 1 ? '' : 's'} need another pass` : sectionRead >= sectionGuide ? 'Section guide reached' : `Aim for about ${sectionGuide} cartons in this section`}</span>
              <small>Section counts are guidance only; the pallet stops automatically at {targetCount} accepted cartons.{ignoredTracks > 0 ? ` ${ignoredTracks} visible non-target shape${ignoredTracks === 1 ? '' : 's'} ignored.` : ''}</small>
            </div>
            <button className="primary-button" type="button" disabled={activeOcrCount > 0 || queueCount > 0 || labels.length >= targetCount} onClick={nextSection}>
              {section.half === 'top' ? <ArrowDown size={17} /> : <RefreshCw size={17} />}
              {section.half === 'top' ? 'Finish top · scan bottom' : `Finish face ${section.face} · move round`}
            </button>
            <button className="quiet-button" type="button" disabled={labels.length === 0 || activeOcrCount > 0 || queueCount > 0} onClick={undoLastScan}><RotateCcw size={15} /> Undo last</button>
          </div>

          {error && <div className="label-error"><AlertTriangle /> <span>{error}</span></div>}
          {cameraError && <div className="label-error"><AlertTriangle /> <span>{cameraError}</span><button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry camera</button></div>}
        </div>
      )}

      {step === 'result' && (
        <div className={`ean-conformity-card carton-conformity-card ${summary.status}`}>
          <div className="label-result-heading">
            <span className="label-result-icon">{summary.status === 'pass' ? <CheckCircle2 /> : summary.status === 'fail' ? <XCircle /> : <AlertTriangle />}</span>
            <div>
              <span className="eyebrow">{summary.status === 'pass' ? 'LABEL CONFORMITY PASS' : summary.status === 'fail' ? 'LABEL MISMATCH FOUND' : 'LABEL REVIEW REQUIRED'}</span>
              <h2>{summary.total} / {targetCount} cartons read</h2>
              <p>{summary.status === 'pass'
                ? 'The recognised key/value fields agree across the pallet.'
                : summary.status === 'fail'
                  ? `${summary.mismatchCartons} carton${summary.mismatchCartons === 1 ? '' : 's'} differ from the completed-pallet majority.`
                  : `Only ${summary.majorityFields.length} fields had enough OCR evidence to establish a reliable pallet pattern.`}</p>
            </div>
          </div>

          <div className="ean-final-summary carton-final-summary">
            <span>Cartons <strong>{summary.total}</strong></span>
            <span>Compared fields <strong>{summary.majorityFields.length}</strong></span>
            <span>Mismatch cartons <strong>{summary.mismatchCartons}</strong></span>
            <span>Avg OCR <strong>{Math.round(summary.averageConfidence)}%</strong></span>
          </div>

          <div className="carton-majority-fields">
            <div className="carton-majority-head"><span>Field</span><span>Pallet majority</span><span>Read support</span></div>
            {summary.majorityFields.map((field) => (
              <div key={field.field}>
                <strong>{field.label}</strong>
                <span>{field.value}</span>
                <b>{field.support} / {summary.total}</b>
              </div>
            ))}
          </div>

          {summary.issues.length > 0 && (
            <div className="carton-issues">
              <header><strong>Exceptions</strong><span>{mismatchIssues.length} mismatch · {unreadIssues.length} unread</span></header>
              {summary.issues.slice(0, 24).map((issue) => (
                <div className={issue.status} key={`${issue.scanId}-${issue.field}`}>
                  <span>Carton {issue.cartonNumber}</span>
                  <strong>{issue.label}</strong>
                  {issue.section && <em>Face {issue.section.face} · {issue.section.half}</em>}
                  <small>Expected majority</small><b>{issue.expected}</b>
                  <small>Read</small><b>{issue.actual || 'Unread'}</b>
                </div>
              ))}
              {summary.issues.length > 24 && <p>+ {summary.issues.length - 24} more exceptions</p>}
            </div>
          )}

          {labels.at(-1)?.rawText && (
            <details className="label-ocr-details">
              <summary>Last carton raw OCR</summary>
              <pre>{labels.at(-1)?.rawText}</pre>
            </details>
          )}

          <div className="label-result-actions">
            <button className="primary-button" type="button" onClick={reset}><ScanLine size={16} /> New pallet</button>
          </div>
        </div>
      )}
    </section>
  )
}
