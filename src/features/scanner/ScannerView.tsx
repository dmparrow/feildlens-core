import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { Camera, CheckCircle2, RefreshCw, Settings2, ShieldAlert, SwitchCamera, Volume2, VolumeX, Zap, ZapOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { recordScan, type ScanRecord } from '../../lib/database'
import { detectionSpanPercent, formatName, formatsForMode, scanFormatOptions, validateScanPayload, type PayloadRules, type ScanFormatMode } from '../../lib/barcodes'
import { loadScannerPreferences, saveScannerPreferences } from '../../lib/preferences'
import { disableScanAudio, enableScanAudio, getScanAudio } from '../../lib/scanAudio'

type ScannerStatus = 'starting' | 'detecting' | 'captured' | 'duplicate' | 'permission-denied' | 'camera-error' | 'storage-error'
type DetectionPoint = { left: number; top: number }
type ConfirmationCandidate = { value: string; format: BarcodeFormat; count: number; lastSeen: number }
type PendingCapture = { rawValue: string; format: string }

export function ScannerView({ installAction }: { installAction?: ReactNode }) {
  const [initialPreferences] = useState(loadScannerPreferences)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const armedRef = useRef(true)
  const autoAdvanceRef = useRef(initialPreferences.autoAdvance)
  const soundEnabledRef = useRef(initialPreferences.soundEnabled)
  const confirmationFramesRef = useRef(initialPreferences.confirmationFrames)
  const minimumSizeRef = useRef(initialPreferences.minimumSize)
  const payloadRulesRef = useRef<PayloadRules>(initialPreferences.payloadRules)
  const qualitySettingsOpenRef = useRef(false)
  const candidateRef = useRef<ConfirmationCandidate | null>(null)
  const rearmTimerRef = useRef<number | null>(null)
  const lastReadRef = useRef({ value: '', time: 0 })
  const [armed, setArmed] = useState(true)
  const [status, setStatus] = useState<ScannerStatus>('starting')
  const [cameraError, setCameraError] = useState('')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState('')
  const [requestedCamera, setRequestedCamera] = useState('')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(initialPreferences.autoAdvance)
  const [soundEnabled, setSoundEnabled] = useState(initialPreferences.soundEnabled)
  const [formatMode, setFormatMode] = useState<ScanFormatMode>(initialPreferences.formatMode)
  const [confirmationFrames, setConfirmationFrames] = useState(initialPreferences.confirmationFrames)
  const [minimumSize, setMinimumSize] = useState(initialPreferences.minimumSize)
  const [payloadRules, setPayloadRules] = useState<PayloadRules>(initialPreferences.payloadRules)
  const [showQualitySettings, setShowQualitySettings] = useState(false)
  const [qualityMessage, setQualityMessage] = useState('')
  const [confirmationProgress, setConfirmationProgress] = useState(0)
  const [retryKey, setRetryKey] = useState(0)
  const [detectionPoints, setDetectionPoints] = useState<DetectionPoint[]>([])
  const [latest, setLatest] = useState<ScanRecord | null>(null)
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null)

  const setScannerArmed = useCallback((value: boolean) => {
    if (value && rearmTimerRef.current) {
      window.clearTimeout(rearmTimerRef.current)
      rearmTimerRef.current = null
    }
    armedRef.current = value
    setArmed(value)
    if (value) {
      setStatus('detecting')
      setDetectionPoints([])
      setConfirmationProgress(0)
      setQualityMessage('')
      candidateRef.current = null
    }
  }, [])

  const saveCapture = useCallback(async (capture: PendingCapture) => {
    try {
      const record = await recordScan(capture.rawValue, capture.format)
      setPendingCapture(null)
      setLatest(record)
      setStatus(record.isDuplicate ? 'duplicate' : 'captured')
      navigator.vibrate?.(record.isDuplicate ? [80, 70, 80] : 80)
      const audioContext = getScanAudio()
      if (soundEnabledRef.current && audioContext) {
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        oscillator.frequency.value = record.isDuplicate ? 220 : 660
        gain.gain.setValueAtTime(0.08, audioContext.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.16)
        oscillator.connect(gain).connect(audioContext.destination)
        oscillator.start()
        oscillator.stop(audioContext.currentTime + 0.16)
      }

      if (autoAdvanceRef.current) {
        rearmTimerRef.current = window.setTimeout(() => setScannerArmed(true), 1600)
      }
    } catch {
      setStatus('storage-error')
    }
  }, [setScannerArmed])

  const discardPendingCapture = () => {
    setPendingCapture(null)
    setScannerArmed(true)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formatsForMode(formatMode))
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 120,
      delayBetweenScanSuccess: 180,
    })
    let disposed = false
    setStatus('starting')
    setCameraError('')
    setTorchAvailable(false)

    void reader.decodeFromConstraints(
      {
        audio: false,
        video: requestedCamera
          ? { deviceId: { exact: requestedCamera } }
          : { facingMode: { ideal: 'environment' } },
      },
      video,
      (result) => {
        if (!armedRef.current || qualitySettingsOpenRef.current) return
        if (!result) {
          if (candidateRef.current) {
            candidateRef.current = null
            setConfirmationProgress(0)
            setQualityMessage('')
          }
          return
        }

        const rawValue = result.getText()
        const barcodeFormat = result.getBarcodeFormat()
        const now = Date.now()
        if (lastReadRef.current.value === rawValue && now - lastReadRef.current.time < 1200) return

        const stage = stageRef.current
        const points = result.getResultPoints()
        const detectedSize = detectionSpanPercent(points, video.videoWidth, video.videoHeight)
        if (detectedSize !== null && detectedSize < minimumSizeRef.current) {
          candidateRef.current = null
          setConfirmationProgress(0)
          setQualityMessage(`Move closer · code is ${Math.round(detectedSize)}% of frame`)
          return
        }

        const validationError = validateScanPayload(rawValue, barcodeFormat, payloadRulesRef.current)
        if (validationError) {
          candidateRef.current = null
          setConfirmationProgress(0)
          setQualityMessage(validationError)
          return
        }

        const candidate = candidateRef.current
        const isSameCandidate = candidate?.value === rawValue && candidate.format === barcodeFormat && now - candidate.lastSeen < 1000
        const nextCount = isSameCandidate ? candidate.count + 1 : 1
        candidateRef.current = { value: rawValue, format: barcodeFormat, count: nextCount, lastSeen: now }
        setConfirmationProgress(nextCount)
        setQualityMessage(nextCount < confirmationFramesRef.current ? `Hold steady · confirming ${nextCount}/${confirmationFramesRef.current}` : '')
        if (nextCount < confirmationFramesRef.current) return

        candidateRef.current = null
        lastReadRef.current = { value: rawValue, time: now }
        setScannerArmed(false)

        if (stage && video.videoWidth && video.videoHeight && points.length) {
          const scale = Math.max(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
          const offsetX = (stage.clientWidth - video.videoWidth * scale) / 2
          const offsetY = (stage.clientHeight - video.videoHeight * scale) / 2
          setDetectionPoints(points.map((point) => ({
            left: Math.min(100, Math.max(0, ((offsetX + point.getX() * scale) / stage.clientWidth) * 100)),
            top: Math.min(100, Math.max(0, ((offsetY + point.getY() * scale) / stage.clientHeight) * 100)),
          })))
        }

        const format = formatName(BarcodeFormat[barcodeFormat] ?? 'Barcode')
        const capture = { rawValue, format }
        setPendingCapture(capture)
        void saveCapture(capture)
      },
    ).then((controls) => {
      if (disposed) controls.stop()
      else {
        controlsRef.current = controls
        setTorchAvailable(Boolean(controls.switchTorch))
        setStatus('detecting')

        void BrowserMultiFormatReader.listVideoInputDevices().then((devices) => {
          if (disposed) return
          setCameras(devices)
          const activeDevice = controls.streamVideoSettingsGet?.((track) => [track]).deviceId
          if (activeDevice) setSelectedCamera(activeDevice)
        })
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Camera access failed.'
      setCameraError(message)
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission-denied' : 'camera-error')
    })

    return () => {
      disposed = true
      controlsRef.current?.stop()
      controlsRef.current = null
      setTorchOn(false)
    }
  }, [formatMode, requestedCamera, retryKey, saveCapture, setScannerArmed])

  useEffect(() => () => {
    if (rearmTimerRef.current) window.clearTimeout(rearmTimerRef.current)
  }, [])

  const toggleTorch = async () => {
    const nextValue = !torchOn
    try {
      await controlsRef.current?.switchTorch?.(nextValue)
      setTorchOn(nextValue)
    } catch {
      setTorchAvailable(false)
      setTorchOn(false)
    }
  }

  const toggleAutoAdvance = () => {
    const nextValue = !autoAdvance
    autoAdvanceRef.current = nextValue
    setAutoAdvance(nextValue)
    saveScannerPreferences({ ...loadScannerPreferences(), autoAdvance: nextValue })
    if (!nextValue && rearmTimerRef.current) {
      window.clearTimeout(rearmTimerRef.current)
      rearmTimerRef.current = null
    }
  }

  const toggleSound = () => {
    const nextValue = !soundEnabled
    if (nextValue) enableScanAudio()
    else disableScanAudio()
    soundEnabledRef.current = nextValue
    setSoundEnabled(nextValue)
    saveScannerPreferences({ ...loadScannerPreferences(), soundEnabled: nextValue })
  }

  const updateConfirmationFrames = (value: 2 | 3) => {
    confirmationFramesRef.current = value
    setConfirmationFrames(value)
    saveScannerPreferences({ ...loadScannerPreferences(), confirmationFrames: value })
    candidateRef.current = null
    setConfirmationProgress(0)
  }

  const updateMinimumSize = (value: number) => {
    minimumSizeRef.current = value
    setMinimumSize(value)
    saveScannerPreferences({ ...loadScannerPreferences(), minimumSize: value })
  }

  const updatePayloadRules = (rules: PayloadRules) => {
    payloadRulesRef.current = rules
    setPayloadRules(rules)
    saveScannerPreferences({ ...loadScannerPreferences(), payloadRules: rules })
    candidateRef.current = null
    setConfirmationProgress(0)
  }

  const toggleQualitySettings = () => {
    const nextValue = !showQualitySettings
    qualitySettingsOpenRef.current = nextValue
    setShowQualitySettings(nextValue)
    candidateRef.current = null
    setConfirmationProgress(0)
    setQualityMessage('')
  }

  const retryCamera = () => {
    setScannerArmed(true)
    setRetryKey((value) => value + 1)
  }

  const statusLabel = {
    starting: 'STARTING CAMERA',
    detecting: 'AUTO DETECTING',
    captured: 'CAPTURED',
    duplicate: 'DUPLICATE',
    'permission-denied': 'CAMERA BLOCKED',
    'camera-error': 'CAMERA ERROR',
    'storage-error': 'SAVE FAILED',
  }[status]

  return (
    <section className="scanner-view" aria-labelledby="scanner-title">
      <div className={`camera-stage scanner-${status} ${showQualitySettings ? 'quality-settings-open' : ''}`} ref={stageRef}>
        <video ref={videoRef} autoPlay muted playsInline aria-label="Rear camera preview" />
        <div className="camera-shade" />
        <div className="camera-heading">
          <div>
            <span className="eyebrow">FIELDLENS / LIVE</span>
            <h1 id="scanner-title">Scan station</h1>
          </div>
          <div className="camera-actions">
            <span className="local-badge"><span /> {statusLabel}</span>
            {installAction}
          </div>
        </div>
        <div className="camera-tools" aria-label="Scanner controls">
          {cameras.length > 1 && (
            <label className="camera-select">
              <SwitchCamera size={15} />
              <span className="sr-only">Camera</span>
              <select value={selectedCamera} onChange={(event) => { setSelectedCamera(event.target.value); setRequestedCamera(event.target.value) }}>
                {cameras.map((camera, index) => <option value={camera.deviceId} key={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          {torchAvailable && (
            <button className="camera-tool-button" type="button" aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'} title={torchOn ? 'Turn torch off' : 'Turn torch on'} aria-pressed={torchOn} onClick={() => void toggleTorch()}>
              {torchOn ? <ZapOff /> : <Zap />}
            </button>
          )}
          <button className="camera-tool-button" type="button" aria-label={soundEnabled ? 'Turn scan sounds off' : 'Turn scan sounds on'} title={soundEnabled ? 'Turn scan sounds off' : 'Turn scan sounds on'} aria-pressed={soundEnabled} onClick={toggleSound}>
            {soundEnabled ? <Volume2 /> : <VolumeX />}
          </button>
          <button className="auto-toggle" type="button" aria-pressed={autoAdvance} onClick={toggleAutoAdvance}>
            <span /> Auto next
          </button>
          <button className="camera-tool-button" type="button" aria-label="Scan quality settings" title="Scan quality settings" aria-expanded={showQualitySettings} onClick={toggleQualitySettings}>
            <Settings2 />
          </button>
        </div>
        {showQualitySettings && (
          <div className="quality-panel">
            <label><span>Formats</span><select value={formatMode} onChange={(event) => { const value = event.target.value as ScanFormatMode; setFormatMode(value); saveScannerPreferences({ ...loadScannerPreferences(), formatMode: value }) }}>{scanFormatOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label><span>Confirm reads</span><select value={confirmationFrames} onChange={(event) => updateConfirmationFrames(Number(event.target.value) as 2 | 3)}><option value="2">2 frames</option><option value="3">3 frames</option></select></label>
            <label className="quality-range"><span>Minimum size <b>{minimumSize}%</b></span><input type="range" min="0" max="20" step="1" value={minimumSize} onChange={(event) => updateMinimumSize(Number(event.target.value))} /></label>
            <label className="quality-check"><input type="checkbox" checked={payloadRules.enabled} onChange={(event) => updatePayloadRules({ ...payloadRules, enabled: event.target.checked })} /><span>Validate known barcode standards</span></label>
            <label><span>Expected length</span><input type="number" min="0" max="256" inputMode="numeric" placeholder="Any" value={payloadRules.expectedLength || ''} onChange={(event) => updatePayloadRules({ ...payloadRules, expectedLength: Math.max(0, Number(event.target.value)) })} /></label>
            <label><span>Required prefix</span><input type="text" placeholder="Any" value={payloadRules.requiredPrefix} onChange={(event) => updatePayloadRules({ ...payloadRules, requiredPrefix: event.target.value })} /></label>
          </div>
        )}
        <div className={`scan-frame ${latest && /QR|Data Matrix|Aztec|MaxiCode/i.test(latest.format) ? 'matrix' : ''}`} aria-hidden="true"><span /><span /><span /><span /></div>
        {detectionPoints.map((point, index) => <i className="detection-point" style={{ left: `${point.left}%`, top: `${point.top}%` }} key={index} />)}
        <p className="camera-instruction" aria-live="polite">
          {cameraError || (showQualitySettings ? 'Scanning paused while settings are open' : qualityMessage || (status === 'starting' ? 'Preparing the rear camera' : armed ? `Barcode type is detected automatically${confirmationProgress ? ` · ${confirmationProgress}/${confirmationFrames}` : ''}` : autoAdvance ? 'Captured · scanner will rearm automatically' : 'Capture held for review'))}
        </p>
      </div>

      <div className={`scan-result ${latest?.isDuplicate ? 'duplicate' : ''}`} aria-live="polite">
        <div className="result-icon">
          {latest?.isDuplicate ? <ShieldAlert /> : latest ? <CheckCircle2 /> : <Camera />}
        </div>
        <div className="result-copy">
          <span className="eyebrow">
            {status === 'storage-error' ? 'CAPTURE NOT SAVED' : cameraError ? 'CAMERA UNAVAILABLE' : latest?.isDuplicate ? 'DUPLICATE DETECTED' : latest ? 'CAPTURE SAVED' : 'SCANNER READY'}
          </span>
          <strong>{status === 'storage-error' ? pendingCapture?.rawValue : cameraError ? 'Camera access required' : latest?.rawValue ?? 'Waiting for a code'}</strong>
          <small>{status === 'storage-error' ? 'Local storage failed. Retry saving or discard this capture.' : cameraError ? (status === 'permission-denied' ? 'Allow camera access in browser settings, then try again.' : 'Check that a camera is available, then try again.') : latest ? `${latest.format} · stored on this device` : 'Nothing leaves the device until sync is configured.'}</small>
        </div>
        {status === 'storage-error' && pendingCapture ? (
          <div className="result-actions">
            <button className="quiet-button" type="button" onClick={discardPendingCapture}>Discard</button>
            <button className="primary-button" type="button" onClick={() => void saveCapture(pendingCapture)}><RefreshCw size={17} /> Retry save</button>
          </div>
        ) : cameraError ? (
          <button className="primary-button" type="button" onClick={retryCamera}><RefreshCw size={17} /> Try camera again</button>
        ) : (
          <button className="primary-button" type="button" disabled={armed} onClick={() => setScannerArmed(true)}>
            <RefreshCw size={17} /> Scan next
          </button>
        )}
      </div>
    </section>
  )
}
