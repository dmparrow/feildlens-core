import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCheck, CloudDownload, FlaskConical, History, LoaderCircle, ScanLine, Settings, Share, Smartphone, SquarePlus, Wifi, WifiOff, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import './App.css'
import { database } from './lib/database'

const ScannerView = lazy(() => import('./features/scanner/ScannerView').then((module) => ({ default: module.ScannerView })))
const LabelCheckView = lazy(() => import('./features/label-check/LabelCheckView').then((module) => ({ default: module.LabelCheckView })))
const HistoryView = lazy(() => import('./features/history/HistoryView').then((module) => ({ default: module.HistoryView })))
const CodeLab = lazy(() => import('./features/codes/CodeLab').then((module) => ({ default: module.CodeLab })))
const SettingsView = lazy(() => import('./features/settings/SettingsView').then((module) => ({ default: module.SettingsView })))

type View = 'scanner' | 'label-check' | 'history' | 'lab' | 'settings'
type NavigationItem = { id: View; label: string; mobileLabel?: string; icon: typeof ScanLine }

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const navigation: NavigationItem[] = [
  { id: 'scanner', label: 'Scanner', icon: ScanLine },
  { id: 'label-check', label: 'EAN pallet', mobileLabel: 'EAN', icon: ClipboardCheck },
  { id: 'history', label: 'History', icon: History },
  { id: 'lab', label: 'Code lab', mobileLabel: 'Lab', icon: FlaskConical },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function App() {
  const [view, setView] = useState<View>('scanner')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosInstall, setShowIosInstall] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [storageStatus, setStorageStatus] = useState<'checking' | 'persistent' | 'best-effort' | 'unsupported'>('checking')
  const [isInstalled, setIsInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  )
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const installButtonRef = useRef<HTMLButtonElement>(null)
  const installDialogRef = useRef<HTMLDialogElement>(null)
  const scanCount = useLiveQuery(() => database.scans.count(), []) ?? 0
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_serviceWorkerUrl, registration) => setSwRegistration(registration ?? null),
  })

  const applyUpdate = useCallback(async () => {
    if (isUpdating) return
    setIsUpdating(true)
    setUpdateError('')
    try {
      await updateServiceWorker(true)
    } catch {
      setUpdateError('Update could not be installed. Check your connection and retry.')
      setIsUpdating(false)
    }
  }, [isUpdating, updateServiceWorker])

  useEffect(() => {
    let disposed = false
    const requestPersistentStorage = async () => {
      if (!navigator.storage?.persisted || !navigator.storage.persist) {
        if (!disposed) setStorageStatus('unsupported')
        return
      }
      try {
        const persistent = await navigator.storage.persisted() || await navigator.storage.persist()
        if (!disposed) setStorageStatus(persistent ? 'persistent' : 'best-effort')
      } catch {
        if (!disposed) setStorageStatus('best-effort')
      }
    }
    void requestPersistentStorage()
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      setIsInstalled(true)
    }
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const dialog = installDialogRef.current
    if (!dialog) return
    if (showIosInstall && !dialog.open) dialog.showModal()
    if (!showIosInstall && dialog.open) dialog.close()
  }, [showIosInstall])

  useEffect(() => {
    if (!swRegistration) return
    const checkForUpdate = () => {
      if (navigator.onLine) void swRegistration.update().catch(() => undefined)
    }
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL)
    window.addEventListener('online', checkForUpdate)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', checkForUpdate)
    }
  }, [swRegistration])

  useEffect(() => {
    if (!needRefresh || isUpdating) return
    if (document.visibilityState === 'hidden') {
      const backgroundTimer = window.setTimeout(() => void applyUpdate(), 0)
      return () => window.clearTimeout(backgroundTimer)
    }
    const updateWhenHidden = () => {
      if (document.visibilityState === 'hidden') void applyUpdate()
    }

    document.addEventListener('visibilitychange', updateWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', updateWhenHidden)
    }
  }, [applyUpdate, isUpdating, needRefresh])

  const installApp = async () => {
    if (!installPrompt) {
      setShowIosInstall(true)
      return
    }

    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    setInstallPrompt(null)
    if (outcome === 'accepted') setIsInstalled(true)
  }

  const installAction = !isInstalled && (installPrompt || isIos) ? (
    <button className="install-button" type="button" ref={installButtonRef} onClick={() => void installApp()}>
      <Smartphone size={15} /> Install app
    </button>
  ) : null

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <button className="brand" type="button" onClick={() => setView('scanner')} aria-label="Open scanner">
            <span className="brand-mark"><img src="/fieldlens-mark.svg" width="28" height="28" alt="" aria-hidden="true" /></span>
            <span><strong>FIELDLENS</strong><small>CAPTURE SYSTEM</small></span>
          </button>

          <nav aria-label="Primary navigation">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button className={view === id ? 'active' : ''} type="button" key={id} onClick={() => setView(id)}>
                <Icon size={19} /><span>{label}</span>
                {id === 'history' && scanCount > 0 && <b>{scanCount}</b>}
              </button>
            ))}
          </nav>

          <div className="sidebar-status">
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span><strong>{isOnline ? 'Online' : 'Offline ready'}</strong><small>{storageStatus === 'persistent' ? 'Durable storage' : storageStatus === 'checking' ? 'Checking storage' : 'Best-effort storage'}</small></span>
          </div>
        </aside>

        <main>
          <Suspense fallback={<div className="loading-view">Loading workspace</div>}>
            {view === 'scanner' && <ScannerView installAction={installAction} />}
            {view === 'label-check' && <LabelCheckView onOpenSettings={() => setView('settings')} />}
            {view === 'history' && <HistoryView />}
            {view === 'lab' && <CodeLab />}
            {view === 'settings' && (
              <SettingsView
                storageStatus={storageStatus}
                updateAvailable={needRefresh}
                isUpdating={isUpdating}
                updateError={updateError}
                onApplyUpdate={applyUpdate}
              />
            )}
          </Suspense>
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map(({ id, label, mobileLabel, icon: Icon }) => (
            <button className={view === id ? 'active' : ''} type="button" key={id} onClick={() => setView(id)}>
              <Icon size={20} /><span>{mobileLabel ?? label}</span>
            </button>
          ))}
        </nav>
      </div>

      <dialog className="install-dialog-shell" ref={installDialogRef} aria-labelledby="install-title" onCancel={(event) => { event.preventDefault(); event.currentTarget.close() }} onClose={() => { setShowIosInstall(false); installButtonRef.current?.focus() }} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
        <div className="install-dialog">
          <button className="dialog-close" type="button" autoFocus aria-label="Close" onClick={() => installDialogRef.current?.close()}><X /></button>
          <Smartphone className="install-dialog-icon" />
          <h2 id="install-title">Install FieldLens</h2>
          <p><Share size={18} /> Tap <strong>Share</strong> in Safari.</p>
          <p><SquarePlus size={18} /> Choose <strong>Add to Home Screen</strong>.</p>
        </div>
      </dialog>

      {needRefresh && (
        <aside className={`update-banner ${updateError ? 'error' : ''}`} aria-label="Application update" aria-live="polite">
          <span className="update-icon"><CloudDownload /></span>
          <span className="update-copy">
            <strong>{updateError ? 'Update paused' : isUpdating ? 'Updating FieldLens' : 'Update available'}</strong>
            <small>{updateError || (isUpdating ? 'Installing the latest version…' : 'Update now or FieldLens will refresh after you leave the app.')}</small>
          </span>
          <button type="button" disabled={isUpdating} onClick={() => void applyUpdate()}>
            {isUpdating ? <LoaderCircle className="spinning" /> : <CloudDownload />} {updateError ? 'Retry' : isUpdating ? 'Updating' : 'Update now'}
          </button>
        </aside>
      )}
    </>
  )
}

export default App
