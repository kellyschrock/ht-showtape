import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Channel } from '../show/model'
import { servoDegrees } from '../show/sample'
import { ServoMonitor, type SimServo } from '../playback/monitor'
import { useMonitor } from '../stores/monitor'
import { useShow } from '../stores/show'
import { showTime } from '../stores/transport'
import { useShortcuts } from './shortcuts'

/**
 * Simulated servos: a dial per channel whose horn turns as the show plays,
 * so a show can be watched without hardware. It follows the playhead
 * whether playing, scrubbing or dragging keys, as Servos live does.
 */

function same(a: readonly SimServo[], b: readonly SimServo[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => {
      const o = b[i]!
      return s.channelId === o.channelId && s.degrees === o.degrees && s.wanted === o.wanted && s.holding === o.holding
    })
  )
}

/**
 * Steps the simulation once a frame of `view`, the window it is drawn in.
 * A window's frames and its clock go together, and the editor's own frames
 * stop while it is minimised behind a popped-out monitor.
 */
function useSimServos(view: Window): SimServo[] {
  const [servos, setServos] = useState<SimServo[]>([])
  useEffect(() => {
    const monitor = new ServoMonitor()
    let prev = view.performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = monitor.step(useShow.getState().show, showTime(), now - prev)
      prev = now
      setServos((old) => (same(old, next) ? old : next))
      frame = view.requestAnimationFrame(tick)
    }
    frame = view.requestAnimationFrame(tick)
    return () => view.cancelAnimationFrame(frame)
  }, [view])
  return servos
}

/** The Monitor tab: the dials, or word of where they went while popped out. */
export function MonitorPanel() {
  const popup = useMonitor((s) => s.popup)
  if (popup) {
    return (
      <div className="st-monitor-away">
        <p className="ht-hint">The monitor is open in its own window.</p>
        <div className="ht-row">
          <button type="button" className="ht-btn ht-btn--sm ht-btn--secondary" onClick={() => popup.focus()}>
            Show window
          </button>
          <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" onClick={() => useMonitor.getState().dock()}>
            Bring back
          </button>
        </div>
      </div>
    )
  }
  return <Monitor view={window} />
}

/** Draws the monitor into its own window while it is popped out. Mounted once, by App. */
export function MonitorPopout() {
  const popup = useMonitor((s) => s.popup)
  const root = popup?.document.getElementById('monitor-root')
  return popup && root ? createPortal(<PoppedMonitor popup={popup} />, root) : null
}

function PoppedMonitor({ popup }: { popup: Window }) {
  // Space, Home and the rest work with the monitor window in front too.
  useShortcuts(popup)
  return <Monitor view={popup} />
}

function Monitor({ view }: { view: Window }) {
  const channels = useShow((s) => s.show.channels)
  const servos = useSimServos(view)
  const byId = new Map(servos.map((s) => [s.channelId, s]))
  const popped = view !== window

  return (
    <>
      <div className="st-monitor-head">
        <p className="ht-hint">
          Simulated servos, told what real ones would be: limits, invert, trim, max speed, mute and solo. A dashed horn
          is where the curve wants a servo the speed limit is holding back.
        </p>
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--ghost st-monitor-head__btn"
          title={popped ? 'Dock the monitor back in the editor' : 'Open the monitor in its own window, for another screen'}
          onClick={() => (popped ? useMonitor.getState().dock() : useMonitor.getState().popOut())}
        >
          {popped ? 'Dock' : 'Pop out ↗'}
        </button>
      </div>
      {channels.length === 0 ? <p className="ht-hint">Add a channel to see its servo here.</p> : null}
      <div className="st-monitor">
        {channels.map((c) => {
          const servo = byId.get(c.id)
          return servo ? <Dial key={c.id} channel={c} servo={servo} /> : null
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Dial
// ---------------------------------------------------------------------------

const SIZE = 132
const CX = SIZE / 2
const CY = 70
const TRACK_R = 52
const HORN_R = 42

/** A point `r` from the hub at `deg`: 0 points up, positive turns clockwise. */
function at(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)]
}

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = at(from, r)
  const [x2, y2] = at(to, r)
  return `M${x1},${y1}A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`
}

function Horn({ deg, className, color }: { deg: number; className: string; color?: string }) {
  const [x, y] = at(deg, HORN_R)
  const [bx, by] = at(deg + 180, 10)
  return <line className={className} x1={bx} y1={by} x2={x} y2={y} style={color ? { stroke: color } : undefined} />
}

function Dial({ channel, servo }: { channel: Channel; servo: SimServo }) {
  // The channel's limits and rest as the servo sees them, after invert and trim.
  const a = servoDegrees(channel, channel.min)
  const b = servoDegrees(channel, channel.max)
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const [rx1, ry1] = at(servoDegrees(channel, channel.rest), TRACK_R - 6)
  const [rx2, ry2] = at(servoDegrees(channel, channel.rest), TRACK_R + 6)
  const state = servo.holding ? ' st-dial--held' : servo.lagging ? ' st-dial--lag' : ''

  return (
    <figure className={`st-dial${state}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE - 8}`} role="img" aria-label={`${channel.name}: ${servo.degrees.toFixed(1)} degrees`}>
        {/* The servo seen from above: case and mounting ears, output spline at the hub. */}
        <rect className="st-dial__case" x={CX - 30} y={CY - 18} width={60} height={50} rx={6} />
        <rect className="st-dial__case" x={CX - 40} y={CY + 2} width={80} height={10} rx={3} />
        <path className="st-dial__track" d={arc(-90, 90, TRACK_R)} />
        <path className="st-dial__range" d={arc(lo, hi, TRACK_R)} style={{ stroke: channel.color }} />
        <line className="st-dial__rest" x1={rx1} y1={ry1} x2={rx2} y2={ry2} />
        {servo.lagging ? <Horn deg={servo.wanted} className="st-dial__ghost" color={channel.color} /> : null}
        <Horn deg={servo.degrees} className="st-dial__horn" color={channel.color} />
        <circle className="st-dial__hub" cx={CX} cy={CY} r={7} />
      </svg>
      <figcaption>
        <span className="st-dial__name">{channel.name}</span>
        <span className="st-dial__value">
          {servo.degrees.toFixed(1)}°{servo.holding ? ' · held' : servo.lagging ? ' · lagging' : ''}
        </span>
      </figcaption>
    </figure>
  )
}
