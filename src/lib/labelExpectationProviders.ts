import type { LabelFields } from './labelOcr'

export type ExpectedLabelSpec = { ean: string; fields: LabelFields }

export type LabelExpectationLookup = {
  sourceId: string
  sourceLabel: string
  rows: ExpectedLabelSpec[]
  error?: string
}

export type LabelExpectationProvider = {
  id: string
  label: string
  isAvailable: () => boolean
  lookup: (ean: string) => Promise<ExpectedLabelSpec[]>
}

const providers: LabelExpectationProvider[] = []

export function registerLabelExpectationProvider(provider: LabelExpectationProvider) {
  const index = providers.findIndex((candidate) => candidate.id === provider.id)
  if (index >= 0) providers.splice(index, 1, provider)
  else providers.push(provider)
  return () => unregisterLabelExpectationProvider(provider.id)
}

export function unregisterLabelExpectationProvider(id: string) {
  const index = providers.findIndex((provider) => provider.id === id)
  if (index >= 0) providers.splice(index, 1)
}

export function getAvailableLabelExpectationProviders() {
  return providers.filter((provider) => provider.isAvailable()).map(({ id, label }) => ({ id, label }))
}

export async function lookupExpectedLabels(ean: string): Promise<LabelExpectationLookup> {
  const provider = providers.find((candidate) => candidate.isAvailable())
  if (!provider) return { sourceId: 'local', sourceLabel: 'Local only', rows: [] }

  try {
    return { sourceId: provider.id, sourceLabel: provider.label, rows: await provider.lookup(ean) }
  } catch (error) {
    return {
      sourceId: provider.id,
      sourceLabel: provider.label,
      rows: [],
      error: error instanceof Error ? error.message : `${provider.label} lookup failed.`,
    }
  }
}
