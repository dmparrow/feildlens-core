export type CartonConfig = {
  id: string
  name: string
  count: number
}

const STORAGE_KEY = 'fieldlens-ean-carton-configs'

function isValidConfig(value: unknown): value is CartonConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CartonConfig>
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && typeof candidate.name === 'string'
    && candidate.name.trim().length > 0
    && typeof candidate.count === 'number'
    && Number.isFinite(candidate.count)
    && candidate.count >= 1
    && candidate.count <= 500
}

export function loadCartonConfigs(): CartonConfig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isValidConfig)
      .map((config) => ({ ...config, name: config.name.trim(), count: Math.round(config.count) }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}

function persistCartonConfigs(configs: CartonConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
  } catch {
    // Configs still work for the current screen if browser storage is unavailable.
  }
}

export function upsertCartonConfig(configs: CartonConfig[], name: string, count: number) {
  const cleanName = name.trim()
  const safeCount = Math.max(1, Math.min(500, Math.round(count)))
  const existing = configs.find((config) => config.name.toLowerCase() === cleanName.toLowerCase())
  const config: CartonConfig = existing
    ? { ...existing, name: cleanName, count: safeCount }
    : { id: crypto.randomUUID(), name: cleanName, count: safeCount }
  const next = existing
    ? configs.map((candidate) => candidate.id === existing.id ? config : candidate)
    : [...configs, config]
  next.sort((left, right) => left.name.localeCompare(right.name))
  persistCartonConfigs(next)
  return { configs: next, config }
}
