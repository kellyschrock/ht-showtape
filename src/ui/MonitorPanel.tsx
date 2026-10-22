import { useEffect, useState } from 'react'
import type { Channel } from '../show/model'
import { servoDegrees } from '../show/sample'
import { ServoMonitor, type SimServo } from '../playback/monitor'
import { useShow } from '../stores/show'
import { showTime } from '../stores/transport'

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

/** Steps the simulation once a frame while the panel is open. */
function useSimServos(): SimServo[] {
  const [servos, setServos] = useState<SimServo[]>([])
  useEffect(() => {
    const monitor = new ServoMonitor()
    let prev = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = monitor.step(useShow.getState().show, showTime(), now - prev)
      prev = now
      setServos((old) => (same(old, next) ? old : next))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return servos
}

export function MonitorPanel() {
  const channels = useShow((s) => s.show.channels)
  const servos = useSimServos()
  const byId = new Map(servos.map((s) => [s.channelId, s]))

  if (channels.length === 0) return <p className="ht-hint">Add a channel to see its servo here.</p>
  return (
    <>
      <p className="ht-hint">
        Simulated servos, told what real ones would be: limits, invert, trim, max speed, mute and solo. A dashed horn is
        where the curve wants a servo the speed limit is holding back.
      </p>
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
