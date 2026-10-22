import type { Channel, Ease, Keyframe } from './model'

/**
 * The curve between keyframes, and the limits applied on the way to a
 * servo. The editor draws with these and playback sends with them, so what
 * is on screen is what the servo is told.
 */

function shape(ease: Ease, u: number): number {
  switch (ease) {
    case 'step':
      return 0
    case 'linear':
      return u
    case 'smooth':
      // Smoothstep: zero velocity at both keys, so a mechanism eases into
      // and out of every pose instead of jerking at it.
      return u * u * (3 - 2 * u)
  }
}

/** The track's value at `t` ms. Keys must be sorted. Holds the end values outside them. */
export function sampleKeys(keys: readonly Keyframe[], t: number, rest: number): number {
  const first = keys[0]
  if (!first) return rest
  if (t <= first.t) return first.v
  // Binary search for the last key at or before t.
  let lo = 0
  let hi = keys.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keys[mid]!.t <= t) lo = mid
    else hi = mid - 1
  }
  const a = keys[lo]!
  const b = keys[lo + 1]
  if (!b) return a.v
  const span = b.t - a.t
  if (span <= 0) return b.v
  return a.v + (b.v - a.v) * shape(a.ease, (t - a.t) / span)
}

/** Key values are kept to a tenth of a degree, finer than any linkage can show. */
export function roundDegrees(v: number): number {
  return Math.round(v * 10) / 10
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** The channel's value at `t`, inside its limits. */
export function sampleChannel(channel: Channel, t: number): number {
  return clamp(sampleKeys(channel.keys, t, channel.rest), channel.min, channel.max)
}

/** Degrees at the servo for a channel value: limits, then invert, then trim. */
export function servoDegrees(channel: Channel, v: number): number {
  const limited = clamp(v, channel.min, channel.max)
  return (channel.invert ? -limited : limited) + channel.trim
}

/**
 * Moves `from` toward `to` by no more than `maxSpeed` deg/s over `dtMs`.
 * This is what stands between a seek or a badly drawn key and a mechanism
 * driven into its stop at full speed.
 */
export function slew(from: number, to: number, maxSpeed: number, dtMs: number): number {
  if (maxSpeed <= 0) return to
  const step = (maxSpeed * Math.max(0, dtMs)) / 1000
  const d = to - from
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step
}
