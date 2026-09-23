import bwipjs from 'bwip-js'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { appendGtinCheckDigit, randomDigits } from '../../lib/barcodes'
import './CodeLab.css'

type LabTab = 'barcodes' | 'ean'

type CodeFixture = {
  id: string
  name: string
  bcid: string
  value: string
}

type EanLabelFixture = {
  id: string
  carton: number
  ppin: string
  grower: string
  variety: string
  grade: string
  packer: string
  pickDate: string
  packDate: string
  size: string
  count: string
  region: string
  tempPc: string
}

function makeFixtures(): CodeFixture[] {
  const gtin14 = appendGtinCheckDigit(randomDigits(13))
  const lot = `LOT-${randomDigits(6)}`
  return [
    { id: crypto.randomUUID(), name: 'EAN-13', bcid: 'ean13', value: appendGtinCheckDigit(randomDigits(12)) },
    { id: crypto.randomUUID(), name: 'EAN-8', bcid: 'ean8', value: appendGtinCheckDigit(randomDigits(7)) },
    { id: crypto.randomUUID(), name: 'UPC-A', bcid: 'upca', value: appendGtinCheckDigit(randomDigits(11)) },
    { id: crypto.randomUUID(), name: 'ITF-14', bcid: 'itf14', value: gtin14 },
    { id: crypto.randomUUID(), name: 'Code 128', bcid: 'code128', value: `FL-${randomDigits(10)}` },
    { id: crypto.randomUUID(), name: 'GS1 Digital Link QR', bcid: 'qrcode', value: `https://id.gs1.org/01/${gtin14}/10/${lot}` },
  ]
}

function makeEanFixtures(): EanLabelFixture[] {
  const pallet = {
    ppin: randomDigits(8),
    grower: randomDigits(5),
    variety: 'HASS AVOCADO',
    grade: 'CLASS 1',
    packer: `PK${randomDigits(4)}`,
    pickDate: '09/09/2026',
    packDate: '11/09/2026',
    size: '24',
    count: '24',
    region: 'BAY OF PLENTY',
    tempPc: randomDigits(8),
  }

  return Array.from({ length: 6 }, (_, index) => ({
    id: crypto.randomUUID(),
    carton: index + 1,
    ...pallet,
  }))
}

function CodeCard({ fixture }: { fixture: CodeFixture }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    try {
      bwipjs.toCanvas(canvasRef.current, {
        bcid: fixture.bcid,
        text: fixture.value,
        scale: 3,
        height: fixture.bcid === 'qrcode' ? 24 : 13,
        includetext: fixture.bcid !== 'qrcode',
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
        paddingwidth: 8,
        paddingheight: 8,
      })
    } catch {
      // A failed fixture remains labeled so generator errors are visible during testing.
    }
  }, [fixture])

  return (
    <article className="code-card">
      <div className="code-card-heading"><strong>{fixture.name}</strong><span>VALID SAMPLE</span></div>
      <div className="barcode-canvas"><canvas ref={canvasRef} /></div>
      <code>{fixture.value}</code>
    </article>
  )
}

function EanLabelCard({ fixture }: { fixture: EanLabelFixture }) {
  return (
    <article className="ean-lab-carton">
      <div className="ean-lab-label" aria-label={`EAN carton test label ${fixture.carton}`}>
        <div className="ean-lab-label-head">
          <strong>EXPORT AVOCADOS</strong>
          <span>CARTON {String(fixture.carton).padStart(2, '0')}</span>
        </div>
        <div className="ean-lab-fields">
          <span><b>PPIN</b>{fixture.ppin}</span>
          <span><b>Grower</b>{fixture.grower}</span>
          <span><b>Variety</b>{fixture.variety}</span>
          <span><b>Grade</b>{fixture.grade}</span>
          <span><b>Packer</b>{fixture.packer}</span>
          <span><b>Region</b>{fixture.region}</span>
          <span><b>Pick Date</b>{fixture.pickDate}</span>
          <span><b>Pack Date</b>{fixture.packDate}</span>
          <span><b>Size</b>{fixture.size}</span>
          <span><b>Count</b>{fixture.count}</span>
          <span className="ean-lab-temp"><b>TempPC</b>{fixture.tempPc}</span>
        </div>
      </div>
    </article>
  )
}

export function CodeLab() {
  const [tab, setTab] = useState<LabTab>('barcodes')
  const [fixtures, setFixtures] = useState(makeFixtures)
  const [eanFixtures, setEanFixtures] = useState(makeEanFixtures)

  const regenerate = () => {
    if (tab === 'ean') setEanFixtures(makeEanFixtures())
    else setFixtures(makeFixtures())
  }

  return (
    <section className="workspace-view code-lab" aria-labelledby="lab-title">
      <header className="view-heading">
        <div>
          <span className="eyebrow">VALIDATION BENCH</span>
          <h1 id="lab-title">Code lab</h1>
          <p>{tab === 'ean'
            ? 'Synthetic carton labels for testing pallet detection, OCR and conformity from another screen.'
            : 'Open this view on another screen and scan each symbol from the PWA.'}</p>
        </div>
        <button className="primary-button" type="button" onClick={regenerate}>
          <RefreshCw size={17} /> Generate new set
        </button>
      </header>

      <div className="code-lab-tabs" role="tablist" aria-label="Code lab fixtures">
        <button type="button" role="tab" aria-selected={tab === 'barcodes'} className={tab === 'barcodes' ? 'active' : ''} onClick={() => setTab('barcodes')}>Barcodes</button>
        <button type="button" role="tab" aria-selected={tab === 'ean'} className={tab === 'ean' ? 'active' : ''} onClick={() => setTab('ean')}>EAN labels</button>
      </div>

      {tab === 'barcodes' ? (
        <div className="code-grid">{fixtures.map((fixture) => <CodeCard fixture={fixture} key={fixture.id} />)}</div>
      ) : (
        <div className="ean-lab-grid">{eanFixtures.map((fixture) => <EanLabelCard fixture={fixture} key={fixture.id} />)}</div>
      )}
    </section>
  )
}