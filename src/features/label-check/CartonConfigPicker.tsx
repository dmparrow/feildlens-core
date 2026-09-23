import { useMemo, useState } from 'react'

import { loadCartonConfigs, upsertCartonConfig } from '../../lib/cartonConfigs'
import './CartonConfigPicker.css'

const PRESETS = [
  { value: 160, label: '160 · 8 × 20' },
  { value: 176, label: '176 · 8 × 22' },
] as const

function initialSelection(value: number, saved: ReturnType<typeof loadCartonConfigs>) {
  const preset = PRESETS.find((option) => option.value === value)
  if (preset) return `preset:${preset.value}`
  const config = saved.find((option) => option.count === value)
  return config ? `saved:${config.id}` : 'custom'
}

export function CartonConfigPicker({
  value,
  onChange,
  onStart,
}: {
  value: number
  onChange: (count: number) => void
  onStart: () => void
}) {
  const [savedConfigs, setSavedConfigs] = useState(loadCartonConfigs)
  const [selection, setSelection] = useState(() => initialSelection(value, loadCartonConfigs()))
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const custom = selection === 'custom'

  const selectedSavedConfig = useMemo(
    () => selection.startsWith('saved:') ? savedConfigs.find((config) => `saved:${config.id}` === selection) : undefined,
    [savedConfigs, selection],
  )

  const choose = (nextSelection: string) => {
    setSelection(nextSelection)
    setMessage('')
    if (nextSelection === 'custom') {
      onChange(0)
      return
    }
    if (nextSelection.startsWith('preset:')) {
      onChange(Number(nextSelection.slice('preset:'.length)))
      return
    }
    const config = savedConfigs.find((candidate) => `saved:${candidate.id}` === nextSelection)
    if (config) onChange(config.count)
  }

  const saveCustom = () => {
    const cleanName = name.trim()
    if (!cleanName || value < 1 || value > 500) {
      setMessage('Add a name and carton count first.')
      return
    }
    const saved = upsertCartonConfig(savedConfigs, cleanName, value)
    setSavedConfigs(saved.configs)
    setSelection(`saved:${saved.config.id}`)
    setName('')
    setMessage(`${saved.config.name} saved on this device.`)
  }

  return (
    <div className="ean-config-picker">
      <label htmlFor="ean-carton-config">Carton config</label>
      <div className="ean-config-row">
        <select id="ean-carton-config" className="compact-input" value={selection} onChange={(event) => choose(event.target.value)}>
          {PRESETS.map((option) => <option value={`preset:${option.value}`} key={option.value}>{option.label}</option>)}
          {savedConfigs.map((config) => <option value={`saved:${config.id}`} key={config.id}>{config.name} · {config.count}</option>)}
          <option value="custom">Custom…</option>
        </select>
        <button className="primary-button" type="button" disabled={value < 1} onClick={onStart}>Start scan</button>
      </div>

      {custom && (
        <div className="ean-config-editor">
          <input
            className="compact-input"
            type="text"
            maxLength={40}
            placeholder="Config name"
            aria-label="Carton config name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="compact-input"
            type="number"
            min="1"
            max="500"
            inputMode="numeric"
            placeholder="Cartons"
            aria-label="Custom carton count"
            value={value || ''}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <button className="quiet-button" type="button" disabled={!name.trim() || value < 1} onClick={saveCustom}>Save config</button>
        </div>
      )}

      {!custom && selectedSavedConfig && <small className="ean-config-note">Saved locally · {selectedSavedConfig.count} cartons</small>}
      {message && <small className="ean-config-note">{message}</small>}
    </div>
  )
}
