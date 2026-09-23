import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import './ArPalletOverlay.css'

export type ArDetectionState = 'candidate' | 'accepted' | 'invalid'

export type ArDetection = {
  ean: string
  state: ArDetectionState
  sourceWidth: number
  sourceHeight: number
  box: {
    x: number
    y: number
    width: number
    height: number
  }
}

type ArRememberedPosition = {
  scanNumber: number
  ean: string
  sourceWidth: number
  sourceHeight: number
  box: ArDetection['box']
}

type PointLike = {
  getX?: () => number
  getY?: () => number
  x?: number
  y?: number
}

function pointCoordinate(point: PointLike, axis: 'x' | 'y') {
  const getter = axis === 'x' ? point.getX : point.getY
  const fallback = axis === 'x' ? point.x : point.y
  return typeof getter === 'function' ? getter.call(point) : typeof fallback === 'number' ? fallback : 0
}

export function createArDetection(
  ean: string,
  state: ArDetectionState,
  points: PointLike[] | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ArDetection | null {
  if (!sourceWidth || !sourceHeight || !points?.length) return null

  const xs = points.map((point) => pointCoordinate(point, 'x'))
  const ys = points.map((point) => pointCoordinate(point, 'y'))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rawWidth = Math.max(1, maxX - minX)
  const rawHeight = Math.max(1, maxY - minY)
  const width = Math.max(rawWidth + sourceWidth * 0.04, sourceWidth * 0.18)
  const height = Math.max(rawHeight + sourceHeight * 0.035, sourceHeight * 0.09)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const x = Math.max(0, Math.min(sourceWidth - width, centerX - width / 2))
  const y = Math.max(0, Math.min(sourceHeight - height, centerY - height / 2))

  return {
    ean,
    state,
    sourceWidth,
    sourceHeight,
    box: { x, y, width, height },
  }
}

const STATUS_COLOR: Record<ArDetectionState, number> = {
  candidate: 0xf4d35e,
  accepted: 0x66cf9d,
  invalid: 0xed736a,
}

function projectBox(
  item: Pick<ArDetection, 'sourceWidth' | 'sourceHeight' | 'box'>,
  hostWidth: number,
  hostHeight: number,
) {
  const scale = Math.max(hostWidth / item.sourceWidth, hostHeight / item.sourceHeight)
  const renderedWidth = item.sourceWidth * scale
  const renderedHeight = item.sourceHeight * scale
  const offsetX = (hostWidth - renderedWidth) / 2
  const offsetY = (hostHeight - renderedHeight) / 2
  const left = offsetX + item.box.x * scale
  const top = offsetY + item.box.y * scale
  return {
    left,
    top,
    right: left + item.box.width * scale,
    bottom: top + item.box.height * scale,
  }
}

function lineVertices(item: Pick<ArDetection, 'sourceWidth' | 'sourceHeight' | 'box'>, hostWidth: number, hostHeight: number) {
  const { left, top, right, bottom } = projectBox(item, hostWidth, hostHeight)
  return new Float32Array([
    left, hostHeight - top, 0,
    right, hostHeight - top, 0,
    right, hostHeight - bottom, 0,
    left, hostHeight - bottom, 0,
  ])
}

export function ArPalletOverlay({
  enabled,
  detection,
  scanned,
  target,
  uniqueEans,
}: {
  enabled: boolean
  detection: ArDetection | null
  scanned: number
  target: number
  uniqueEans: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const lineRef = useRef<THREE.LineLoop | null>(null)
  const materialRef = useRef<THREE.LineBasicMaterial | null>(null)
  const memoryGroupRef = useRef<THREE.Group | null>(null)
  const lastScannedRef = useRef(0)
  const [available, setAvailable] = useState(true)
  const [remembered, setRemembered] = useState<ArRememberedPosition[]>([])

  useEffect(() => {
    if (scanned === 0) {
      lastScannedRef.current = 0
      setRemembered([])
      return
    }

    if (scanned < lastScannedRef.current) {
      lastScannedRef.current = scanned
      setRemembered((current) => current.filter((position) => position.scanNumber <= scanned))
      return
    }

    if (scanned > lastScannedRef.current && detection?.state === 'accepted') {
      const next: ArRememberedPosition = {
        scanNumber: scanned,
        ean: detection.ean,
        sourceWidth: detection.sourceWidth,
        sourceHeight: detection.sourceHeight,
        box: { ...detection.box },
      }
      lastScannedRef.current = scanned
      setRemembered((current) => [...current.filter((position) => position.scanNumber < scanned), next])
      return
    }

    lastScannedRef.current = scanned
  }, [detection, scanned])

  useEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    try {
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
      renderer.setClearColor(0x000000, 0)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      const scene = new THREE.Scene()
      const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10)
      camera.position.z = 1
      const geometry = new THREE.BufferGeometry()
      const material = new THREE.LineBasicMaterial({ color: STATUS_COLOR.candidate, transparent: true, opacity: 0.98 })
      const line = new THREE.LineLoop(geometry, material)
      const memoryGroup = new THREE.Group()
      line.visible = false
      scene.add(memoryGroup)
      scene.add(line)

      rendererRef.current = renderer
      sceneRef.current = scene
      cameraRef.current = camera
      lineRef.current = line
      materialRef.current = material
      memoryGroupRef.current = memoryGroup
      setAvailable(true)

      const render = () => {
        const width = Math.max(1, host.clientWidth)
        const height = Math.max(1, host.clientHeight)
        renderer.setSize(width, height, false)
        camera.left = 0
        camera.right = width
        camera.top = height
        camera.bottom = 0
        camera.updateProjectionMatrix()
        renderer.render(scene, camera)
      }

      const resizeObserver = new ResizeObserver(render)
      resizeObserver.observe(host)
      render()

      return () => {
        resizeObserver.disconnect()
        geometry.dispose()
        material.dispose()
        for (const child of [...memoryGroup.children]) {
          memoryGroup.remove(child)
          if (child instanceof THREE.LineLoop) {
            child.geometry.dispose()
            if (child.material instanceof THREE.Material) child.material.dispose()
          }
        }
        renderer.dispose()
        rendererRef.current = null
        sceneRef.current = null
        cameraRef.current = null
        lineRef.current = null
        materialRef.current = null
        memoryGroupRef.current = null
      }
    } catch {
      setAvailable(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !available) return
    const host = hostRef.current
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    const line = lineRef.current
    const material = materialRef.current
    const memoryGroup = memoryGroupRef.current
    if (!host || !renderer || !scene || !camera || !line || !material || !memoryGroup) return

    const hostWidth = Math.max(1, host.clientWidth)
    const hostHeight = Math.max(1, host.clientHeight)

    for (const child of [...memoryGroup.children]) {
      memoryGroup.remove(child)
      if (child instanceof THREE.LineLoop) {
        child.geometry.dispose()
        if (child.material instanceof THREE.Material) child.material.dispose()
      }
    }

    for (const position of remembered) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(lineVertices(position, hostWidth, hostHeight), 3))
      const rememberedMaterial = new THREE.LineBasicMaterial({ color: STATUS_COLOR.accepted, transparent: true, opacity: 0.34 })
      memoryGroup.add(new THREE.LineLoop(geometry, rememberedMaterial))
    }

    if (!detection) {
      line.visible = false
      renderer.render(scene, camera)
      return
    }

    line.geometry.setAttribute('position', new THREE.BufferAttribute(lineVertices(detection, hostWidth, hostHeight), 3))
    line.geometry.computeBoundingSphere()
    material.color.setHex(STATUS_COLOR[detection.state])
    line.visible = true
    renderer.render(scene, camera)
  }, [available, detection, enabled, remembered])

  if (!enabled) return null

  return (
    <div className="ar-overlay" ref={hostRef} aria-hidden="true">
      {available && <canvas ref={canvasRef} className="ar-overlay-canvas" />}
      <div className="ar-overlay-hud">
        <span className="ar-mode-badge">AR ASSIST</span>
        <strong>{scanned} / {target}</strong>
        <small>{uniqueEans || 0} EAN value{uniqueEans === 1 ? '' : 's'} seen · {remembered.length} positions remembered</small>
      </div>
      {remembered.length > 0 && (
        <div className="ar-memory-map">
          <span>POSITION MEMORY</span>
          <div className="ar-memory-field">
            {remembered.map((position) => {
              const centerX = ((position.box.x + position.box.width / 2) / position.sourceWidth) * 100
              const centerY = ((position.box.y + position.box.height / 2) / position.sourceHeight) * 100
              return <i key={position.scanNumber} style={{ left: `${centerX}%`, top: `${centerY}%` }} />
            })}
          </div>
          <small>{remembered.length} / {target}</small>
        </div>
      )}
      {detection && (
        <div className={`ar-detection-readout ${detection.state}`}>
          <strong>{detection.ean}</strong>
          <span>{detection.state === 'accepted' ? 'accepted · position saved' : detection.state === 'invalid' ? 'invalid EAN' : 'hold steady'}</span>
        </div>
      )}
      {!available && <div className="ar-unavailable">AR overlay unavailable · scanner continues normally</div>}
    </div>
  )
}
