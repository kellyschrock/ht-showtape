import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { protocolLabel } from '@ht/protocol'
import { effectiveProtocol, sortKeys, type Channel, type Keyframe, type Show } from '../show/model'
import { clamp, followChannel, roundDegrees, sampleChannel, tooFastSegments } from '../show/sample'
import { snap as snapTo, snapStep } from '../show/timecode'
import { mapChannel, useShow } from '../stores/show'
import { useTransport } from '../stores/transport'

/**
 * The timeline: a ruler, then one lane per channel with its curve and keys.
 *
 * Everything scrolls together. The track headers stick to the left and the
 * ruler to the top, as in an audio editor. Times become pixels through the
 * zoom (pixels per second) and nothing else, so the ruler, the grid, the
 * curves and the playhead cannot drift apart.
 */

const HEADER_W = 220
const LANE_H = 92
const RULER_H = 30
const PAD = 10

function xOf(ms: number, zoom: number): number {
  return (ms * zoom) / 1000
}

function msOf(x: number, zoom: number): number {
  return (x * 1000) / zoom
}

/** Ruler spacing: a tidy step that lands major marks roughly `target` px apart. */
function gridFor(show: Show, zoom: number, target = 90): { major: number; minor: number; label(ms: number): string } {
  const bpm = show.source.bpm
  if (bpm) {
    const beat = 60000 / bpm
    const beats = [1, 2, 4, 8, 16, 32, 64].find((n) => xOf(n * beat, zoom) >= target) ?? 64
    return {
      major: beats * beat,
      minor: beats >= 4 ? beat : beat / 4,
      label: (ms) => {
        const b = Math.round(ms / beat)
        return `${Math.floor(b / 4) + 1}.${(b % 4) + 1}`
      },
    }
  }
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000]
  const major = steps.find((s) => xOf(s, zoom) >= target) ?? 60000
  return {
    major,
    minor: major / (major === 15000 ? 3 : major >= 1000 && String(major)[0] === '2' ? 4 : 5),
    label: (ms) => {
      const s = ms / 1000
      const m = Math.floor(s / 60)
      const rest = s - m * 60
      const secs = major < 1000 ? rest.toFixed(1) : String(Math.round(rest))
      return `${m}:${secs.padStart(major < 1000 ? 4 : 2, '0')}`
    },
  }
}

function gridBackground(majorPx: number, minorPx: number): CSSProperties {
  return {
    backgroundImage:
      'linear-gradient(to right, var(--st-grid-major) 1px, transparent 1px), linear-gradient(to right, var(--st-grid-minor) 1px, transparent 1px)',
    backgroundSize: `${majorPx}px 100%, ${minorPx}px 100%`,
  }
}

// ---------------------------------------------------------------------------
// Ruler and playhead
// ---------------------------------------------------------------------------

function Ruler({ width, show, zoom }: { width: number; show: Show; zoom: number }) {
  const grid = gridFor(show, zoom)
  const seek = useTransport((s) => s.seek)
  const marks: number[] = []
  for (let t = 0; t <= show.source.durationMs; t += grid.major) marks.push(t)

  function scrub(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(msOf(e.clientX - rect.left, zoom))
  }

  return (
    <div
      className="st-ruler"
      style={{ width, ...gridBackground(xOf(grid.major, zoom), xOf(grid.minor, zoom)) }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        scrub(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e)
      }}
    >
      {marks.map((t) => (
        <span key={t} className="st-ruler__mark" style={{ left: xOf(t, zoom) }}>
          {grid.label(t)}
        </span>
      ))}
    </div>
  )
}

function Playhead({ zoom, scroller }: { zoom: number; scroller: RefObject<HTMLDivElement | null> }) {
  const t = useTransport((s) => s.positionMs)
  const playing = useTransport((s) => s.playing)
  const x = HEADER_W + xOf(t, zoom)

  // Page along with the playhead as it plays, and go to it when it is sent
  // somewhere off screen (Home, End, the arrow keys). A zoom moves it too,
  // but zooming keeps its own anchor, so only a change of time scrolls.
  const lastT = useRef(t)
  useEffect(() => {
    const moved = t !== lastT.current
    lastT.current = t
    const el = scroller.current
    if (!el || !(moved || playing)) return
    const left = el.scrollLeft + HEADER_W
    const right = el.scrollLeft + el.clientWidth - 40
    if (x > right || x < left) el.scrollLeft = x - HEADER_W - 40
  }, [t, x, playing, scroller])

  return (
    <div className="st-playhead" style={{ transform: `translateX(${x}px)` }}>
      <div className="st-playhead__head" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Track header
// ---------------------------------------------------------------------------

function LiveValue({ channel }: { channel: Channel }) {
  const t = useTransport((s) => s.positionMs)
  return <span className="st-track__value">{sampleChannel(channel, t).toFixed(1)}°</span>
}

function TrackHeader({ channel, show, selected }: { channel: Channel; show: Show; selected: boolean }) {
  const select = useShow((s) => s.select)
  const updateChannel = useShow((s) => s.updateChannel)
  const protocol = effectiveProtocol(show, channel)
  return (
    <div
      className={`st-track__header${selected ? ' st-track__header--on' : ''}`}
      style={{ height: LANE_H, ['--st-track-color' as string]: channel.color }}
      onPointerDown={() => select({ channelId: channel.id, keyIds: [] })}
    >
      <div className="st-track__name">{channel.name}</div>
      <div className="st-track__meta">
        <span>
          ID {channel.servo.servoId}
          {protocol === 'dronecan' ? '' : ` · node ${channel.servo.nodeId}`}
        </span>
        <span className={`st-proto${channel.servo.protocol === 'default' ? '' : ' st-proto--own'}`}>
          {protocolLabel(protocol)}
        </span>
      </div>
      <div className="st-track__foot">
        <button
          type="button"
          className={`st-ms${channel.mute ? ' st-ms--mute' : ''}`}
          title="Mute: this servo holds still"
          aria-pressed={channel.mute}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateChannel(channel.id, { mute: !channel.mute })}
        >
          M
        </button>
        <button
          type="button"
          className={`st-ms${channel.solo ? ' st-ms--solo' : ''}`}
          title="Solo: only soloed servos move"
          aria-pressed={channel.solo}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateChannel(channel.id, { solo: !channel.solo })}
        >
          S
        </button>
        <LiveValue channel={channel} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lane
// ---------------------------------------------------------------------------

/**
 * The curve as an SVG path, drawn from the keys rather than sampled. A
 * smooth segment is smoothstep, which is exactly a cubic Bézier with its
 * control points a third of the way along at each end's value.
 */
function curvePath(channel: Channel, width: number, x: (t: number) => number, y: (v: number) => number): string {
  const keys = channel.keys
  const first = keys[0]
  if (!first) return `M0,${y(channel.rest)}H${width}`
  let d = `M0,${y(first.v)}H${x(first.t)}`
  for (let i = 0; i < keys.length - 1; i++) d += segmentPath(keys[i]!, keys[i + 1]!, x, y)
  return `${d}H${width}`
}

/** One segment of the curve, drawn on from its first key. */
function segmentPath(a: Keyframe, b: Keyframe, x: (t: number) => number, y: (v: number) => number): string {
  const xa = x(a.t)
  const xb = x(b.t)
  if (a.ease === 'step') return `H${xb}V${y(b.v)}`
  if (a.ease === 'linear') return `L${xb},${y(b.v)}`
  const dx = (xb - xa) / 3
  return `C${xa + dx},${y(a.v)} ${xb - dx},${y(b.v)} ${xb},${y(b.v)}`
}

/** Below this many degrees off the curve, the servo counts as keeping up. */
const LAG_DEG = 0.5

/**
 * Where the servo falls behind the curve, as a path of only those stretches.
 * Everywhere else it is on the curve, and a second line there is noise.
 */
function lagPath(channel: Channel, follow: readonly number[], stepMs: number, x: (t: number) => number, y: (v: number) => number): string {
  let d = ''
  let open = false
  for (let i = 0; i < follow.length; i++) {
    const t = i * stepMs
    const lagging = Math.abs(follow[i]! - sampleChannel(channel, t)) > LAG_DEG
    if (lagging) {
      // Start a step early, from where it was still on the curve, so the line leaves the curve.
      if (!open) d += i > 0 ? `M${x(t - stepMs)},${y(follow[i - 1]!)}` : `M${x(t)},${y(follow[i]!)}`
      d += `L${x(t)},${y(follow[i]!)}`
      open = true
    } else if (open) {
      d += `L${x(t)},${y(follow[i]!)}`
      open = false
    }
  }
  return d
}

interface Drag {
  pointerId: number
  startX: number
  startY: number
  anchor: Keyframe
  origin: Map<string, { t: number; v: number }>
  started: boolean
}

function Lane({ channel, show, width, zoom, selected }: { channel: Channel; show: Show; width: number; zoom: number; selected: string[] }) {
  const select = useShow((s) => s.select)
  const addKey = useShow((s) => s.addKey)
  const snapOn = useTransport((s) => s.snap)
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const range = channel.max - channel.min || 1
  const inner = LANE_H - PAD * 2
  const x = (t: number) => xOf(t, zoom)
  const y = (v: number) => PAD + ((channel.max - v) / range) * inner
  const vOf = (py: number) => clamp(channel.max - ((py - PAD) / inner) * range, channel.min, channel.max)
  const step = snapStep(show.source.fps, show.source.bpm)

  const path = curvePath(channel, width, x, y)
  const stepMs = 1000 / show.outputHz
  const follow = useMemo(() => followChannel(channel, show.source.durationMs, stepMs), [channel, show.source.durationMs, stepMs])
  const lag = lagPath(channel, follow, stepMs, x, y)
  const fast = tooFastSegments(channel)

  function local(e: { clientX: number; clientY: number }): { px: number; py: number } {
    const rect = svg.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  function onKeyDown(e: ReactPointerEvent, key: Keyframe) {
    e.stopPropagation()
    if (e.button !== 0) return
    let ids = selected
    if (e.shiftKey) {
      ids = selected.includes(key.id) ? selected.filter((id) => id !== key.id) : [...selected, key.id]
    } else if (!selected.includes(key.id)) {
      ids = [key.id]
    }
    select({ channelId: channel.id, keyIds: ids })
    const origin = new Map(channel.keys.filter((k) => ids.includes(k.id)).map((k) => [k.id, { t: k.t, v: k.v }]))
    if (!origin.has(key.id)) return
    svg.current!.setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, anchor: key, origin, started: false }
    // Paused, the playhead jumps to the key, so a live servo shows the pose.
    if (!useTransport.getState().playing) useTransport.getState().seek(key.t)
  }

  function onMove(e: ReactPointerEvent) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.started) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return
      d.started = true
      useShow.getState().begin()
    }
    // Snap the key that was grabbed; the rest of the selection keeps its spacing.
    const anchor = d.origin.get(d.anchor.id)!
    let at = anchor.t + msOf(dx, zoom)
    if (snapOn && !e.altKey) at = snapTo(at, step)
    const dt = Math.max(at, 0) - anchor.t
    const minT = Math.min(...[...d.origin.values()].map((o) => o.t))
    const shift = Math.max(dt, -minT)
    const dv = (-dy / inner) * range
    useShow.getState().live((s) =>
      mapChannel(s, channel.id, (c) => ({
        ...c,
        keys: sortKeys(
          c.keys.map((k) => {
            const o = d.origin.get(k.id)
            return o ? { ...k, t: Math.round(o.t + shift), v: roundDegrees(clamp(o.v + dv, c.min, c.max)) } : k
          })
        ),
      }))
    )
    if (!useTransport.getState().playing) useTransport.getState().seek(anchor.t + shift)
  }

  function onUp(e: ReactPointerEvent) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  const zero = channel.min < 0 && channel.max > 0 ? y(0) : null

  return (
    <svg
      ref={svg}
      className="st-lane"
      width={width}
      height={LANE_H}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        select({ channelId: channel.id, keyIds: e.shiftKey ? selected : [] })
      }}
      onDoubleClick={(e) => {
        const { px, py } = local(e)
        let t = msOf(px, zoom)
        if (snapOn && !e.altKey) t = snapTo(t, step)
        addKey(channel.id, t, vOf(py))
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {zero != null ? <line className="st-lane__zero" x1={0} x2={width} y1={zero} y2={zero} /> : null}
      {[...fast].map(([i, speed]) => {
        const a = channel.keys[i]!
        const b = channel.keys[i + 1]!
        return (
          <path key={a.id} className="st-lane__fast" d={`M${x(a.t)},${y(a.v)}${segmentPath(a, b, x, y)}`}>
            <title>
              {`Asks for ${Number.isFinite(speed) ? Math.round(speed) : '∞'}°/s; the limit is ${channel.maxSpeed}°/s, so the servo lags here`}
            </title>
          </path>
        )
      })}
      <path className="st-lane__curve" d={path} style={{ stroke: channel.color }} />
      {lag ? <path className="st-lane__follow" d={lag} style={{ stroke: channel.color }} /> : null}
      {channel.keys.map((k) => {
        const on = selected.includes(k.id)
        const cx = x(k.t)
        const cy = y(k.v)
        return (
          <g key={k.id} className={`st-key${on ? ' st-key--on' : ''}`} onPointerDown={(e) => onKeyDown(e, k)}>
            <circle className="st-key__hit" cx={cx} cy={cy} r={9} />
            {k.ease === 'step' ? (
              <rect className="st-key__mark" x={cx - 4.5} y={cy - 4.5} width={9} height={9} style={{ stroke: channel.color }} />
            ) : k.ease === 'linear' ? (
              <path className="st-key__mark" d={`M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`} style={{ stroke: channel.color }} />
            ) : (
              <circle className="st-key__mark" cx={cx} cy={cy} r={5} style={{ stroke: channel.color }} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function Timeline() {
  const show = useShow((s) => s.show)
  const selection = useShow((s) => s.selection)
  const addChannel = useShow((s) => s.addChannel)
  const zoom = useTransport((s) => s.zoom)
  const scroller = useRef<HTMLDivElement>(null)
  const pendingAnchor = useRef<{ ms: number; px: number } | null>(null)
  const [, force] = useState(0)

  const width = Math.ceil(xOf(show.source.durationMs, zoom)) + 1
  const grid = gridFor(show, zoom)
  const laneGrid = gridBackground(xOf(grid.major, zoom), xOf(grid.minor, zoom))

  // Ctrl + wheel zooms about the pointer, keeping the time under it still.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey) || !el) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - HEADER_W
      const { zoom: z, setZoom } = useTransport.getState()
      pendingAnchor.current = { ms: msOf(el.scrollLeft + px, z), px }
      setZoom(z * Math.exp(-e.deltaY * 0.0015))
      force((n) => n + 1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useLayoutEffect(() => {
    const a = pendingAnchor.current
    const el = scroller.current
    if (!a || !el) return
    el.scrollLeft = xOf(a.ms, zoom) - a.px
    pendingAnchor.current = null
  }, [zoom])

  return (
    <section className="st-timeline" ref={scroller}>
      <div className="st-timeline__inner" style={{ width: HEADER_W + width }}>
        <div className="st-timeline__top" style={{ height: RULER_H }}>
          <div className="st-corner" style={{ width: HEADER_W }}>
            <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" onClick={() => addChannel()}>
              + Channel
            </button>
          </div>
          <Ruler width={width} show={show} zoom={zoom} />
        </div>

        {show.channels.map((c) => (
          <div key={c.id} className={`st-track${c.mute ? ' st-track--muted' : ''}`}>
            <TrackHeader channel={c} show={show} selected={selection.channelId === c.id} />
            <div
              className={`st-track__lane${selection.channelId === c.id ? ' st-track__lane--on' : ''}`}
              style={laneGrid}
            >
              <Lane
                channel={c}
                show={show}
                width={width}
                zoom={zoom}
                selected={selection.channelId === c.id ? selection.keyIds : []}
              />
            </div>
          </div>
        ))}

        {show.channels.length === 0 ? (
          <div className="st-empty" style={{ marginLeft: HEADER_W }}>
            No channels. Add one, or scan for servos in the Servos tab.
          </div>
        ) : (
          <div className="st-hintline" style={{ marginLeft: HEADER_W }}>
            Double-click a lane to add a key. Drag keys to move them; Shift-click to select several. K adds a key
            at the playhead.
          </div>
        )}

        <Playhead zoom={zoom} scroller={scroller} />
      </div>
    </section>
  )
}
