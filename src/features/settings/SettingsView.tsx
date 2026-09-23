import { CloudDownload, Database, RefreshCcw, ScanLine, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { scanFormatOptions } from '../../lib/barcodes'
import { DEVICE_HOLD_EVENT, getDeviceHoldOrientation, type DeviceHoldOrientation } from '../../lib/deviceOrientation'
import { loadScannerPreferences, resetScannerPreferences, saveScannerPreferences, type ScannerPreferences } from '../../lib/preferences'
import { disableScanAudio, enableScanAudio } from '../../lib/scanAudio'

type StorageStatus = 'checking' | 'persistent' | 'best-effort' | 'unsupported'

type SettingsViewProps = {
  storageStatus: StorageStatus
  updateAvailable: boolean
  isUpdating: boolean
  updateError: string
  onApplyUpdate: () => Promise<void>
}

export function SettingsView({ storageStatus, updateAvailable, isUpdating, updateError, onApplyUpdate }: SettingsViewProps) {
  const [preferences, setPreferences] = useState(loadScannerPreferences)
  const [deviceHold, setDeviceHold] = useState<DeviceHoldOrientation>(getDeviceHoldOrientation)

  useEffect(() => {
    const update = () => setDeviceHold(getDeviceHoldOrientation())
    window.addEventListener(DEVICE_HOLD_EVENT, update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener(DEVICE_HOLD_EVENT, update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  const updatePreferences = (updates: Partial<ScannerPreferences>) => {
    const next = { ...preferences, ...updates }
    setPreferences(next)
    saveScannerPreferences(next)
  }

  const updatePayloadRules = (updates: Partial<ScannerPreferences['payloadRules']>) => {
    updatePreferences({ payloadRules: { ...preferences.payloadRules, ...updates } })
  }

  const toggleSound = () => {
    const soundEnabled = !preferences.soundEnabled
    if (soundEnabled) enableScanAudio()
    else disableScanAudio()
    updatePreferences({ soundEnabled })
  }

  const storageLabel = storageStatus === 'persistent' ? 'Durable' : storageStatus === 'checking' ? 'Checking' : storageStatus === 'unsupported' ? 'Browser managed' : 'Best effort'

  return (
    <section className="workspace-view settings-view" aria-labelledby="settings-title">
      <header className="view-heading">
        <div><span className="eyebrow">DEVICE PROFILE</span><h1 id="settings-title">Settings</h1><p>Core scanner defaults are stored locally on this device.</p></div>
        <button className="quiet-button" type="button" onClick={() => setPreferences(resetScannerPreferences())}><RefreshCcw size={16} /> Reset defaults</button>
      </header>

      <div className="settings-layout">
        <section className="settings-section">
          <header><span className="settings-icon"><ScanLine /></span><div><h2>Capture</h2><p>Detection and workflow defaults</p></div></header>
          <div className="setting-row"><label htmlFor="setting-formats"><strong>Barcode formats</strong><small>Choose the decoder profile</small></label><select id="setting-formats" value={preferences.formatMode} onChange={(event) => updatePreferences({ formatMode: event.target.value as ScannerPreferences['formatMode'] })}>{scanFormatOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>
          <div className="setting-row"><div><strong>Phone orientation</strong><small>Detected from how the device is held.</small></div><b>{deviceHold === 'portrait' ? 'Portrait' : 'Landscape'}</b></div>
          <div className="setting-row"><div><strong>Automatic next scan</strong><small>Rearm after a successful capture</small></div><button className="switch-control" type="button" role="switch" aria-checked={preferences.autoAdvance} onClick={() => updatePreferences({ autoAdvance: !preferences.autoAdvance })}><span /></button></div>
          <div className="setting-row"><div><strong>Capture sound</strong><small>Play distinct success and duplicate tones</small></div><button className="switch-control" type="button" role="switch" aria-checked={preferences.soundEnabled} onClick={toggleSound}><span /></button></div>
          <div className="setting-row"><label htmlFor="setting-confirmation"><strong>Confirmation reads</strong><small>Consecutive matches before capture</small></label><select id="setting-confirmation" value={preferences.confirmationFrames} onChange={(event) => updatePreferences({ confirmationFrames: Number(event.target.value) as 2 | 3 })}><option value="2">2 frames</option><option value="3">3 frames</option></select></div>
          <div className="setting-row setting-range"><label htmlFor="setting-size"><strong>Minimum code size</strong><small>Reject distant codes below {preferences.minimumSize}% of frame</small></label><input id="setting-size" type="range" min="0" max="20" value={preferences.minimumSize} onChange={(event) => updatePreferences({ minimumSize: Number(event.target.value) })} /></div>
        </section>

        <section className="settings-section">
          <header><span className="settings-icon"><ShieldCheck /></span><div><h2>Validation</h2><p>Payload acceptance rules</p></div></header>
          <div className="setting-row"><div><strong>Known standards</strong><small>Validate checksums and barcode structure</small></div><button className="switch-control" type="button" role="switch" aria-checked={preferences.payloadRules.enabled} onClick={() => updatePayloadRules({ enabled: !preferences.payloadRules.enabled })}><span /></button></div>
          <div className="setting-row"><label htmlFor="setting-length"><strong>Expected length</strong><small>Zero accepts any payload length</small></label><input id="setting-length" className="compact-input" type="number" min="0" max="256" inputMode="numeric" value={preferences.payloadRules.expectedLength || ''} placeholder="Any" onChange={(event) => updatePayloadRules({ expectedLength: Math.max(0, Number(event.target.value)) })} /></div>
          <div className="setting-row"><label htmlFor="setting-prefix"><strong>Required prefix</strong><small>Optional exact leading characters</small></label><input id="setting-prefix" className="compact-input" type="text" value={preferences.payloadRules.requiredPrefix} placeholder="None" onChange={(event) => updatePayloadRules({ requiredPrefix: event.target.value })} /></div>
        </section>

        <section className="settings-section">
          <header><span className="settings-icon"><Database /></span><div><h2>Local-first storage</h2><p>Core persistence and integration boundary</p></div></header>
          <div className="setting-row"><div><strong>Browser storage</strong><small>Capture data stays usable without a backend</small></div><b>{storageLabel}</b></div>
          <div className="setting-row"><div><strong>Remote integration</strong><small>Register a provider or add sync in the host application</small></div><b>Host supplied</b></div>
        </section>

        <section className="settings-section">
          <header><span className="settings-icon"><CloudDownload /></span><div><h2>Application</h2><p>PWA lifecycle</p></div></header>
          <div className="setting-row"><div><strong>{updateAvailable ? 'Update available' : 'Service worker active'}</strong><small>{updateError || (isUpdating ? 'Installing the latest build…' : updateAvailable ? 'A newer build is ready.' : 'Updates are managed by the PWA service worker.')}</small></div><button className="quiet-button" type="button" disabled={!updateAvailable || isUpdating} onClick={() => void onApplyUpdate()}><CloudDownload size={15} /> {isUpdating ? 'Updating' : 'Update'}</button></div>
        </section>
      </div>
    </section>
  )
}
