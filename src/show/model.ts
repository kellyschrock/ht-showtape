import type { Protocol } from '@ht/protocol'

/**
 * The show document: what gets saved, loaded, edited and played.
 *
 * A show is a timeline. Each channel is one servo, with the limits that
 * keep it safe, and a track of keyframes in degrees. The source says what
 * the timeline is synchronised to; for now only plain time exists, and the
 * others are reserved so a saved show already says what it will need.
 *
 * Plain data only, so a show is its own JSON and undo is a list of
 * snapshots.
 */

export const SHOW_FORMAT = 'hitec-showtape'
export const SHOW_VERSION = 1

export type SourceKind = 'time' | 'audio' | 'midi' | 'smpte'

export const SOURCES: ReadonlyArray<{ kind: SourceKind; label: string; ready: boolean; hint: string }> = [
  { kind: 'time', label: 'Time', ready: true, hint: 'A plain clock. No music, just seconds.' },
  { kind: 'audio', label: 'Audio', ready: false, hint: 'An audio file plays and drives the timeline.' },
  { kind: 'midi', label: 'MIDI', ready: false, hint: 'A .mid file, with its tempo map as the grid.' },
  { kind: 'smpte', label: 'SMPTE', ready: false, hint: 'Chases incoming or recorded timecode.' },
]

export type FrameRate = 24 | 25 | 30

export interface Source {
  kind: SourceKind
  /** How long the timeline runs, in milliseconds. */
  durationMs: number
  /** Frames per second for the timecode readout and frame snapping. */
  fps: FrameRate
  /** Optional tempo for a beat grid. Null shows seconds instead. */
  bpm: number | null
}

/** Which way the curve leaves a keyframe toward the next one. */
export type Ease = 'linear' | 'smooth' | 'step'

export interface Keyframe {
  id: string
  /** Milliseconds from the start of the show. */
  t: number
  /** Degrees from centre, before the channel's invert and trim. */
  v: number
  ease: Ease
}

/** 'default' follows the show's bus setting. */
export type ChannelProtocol = Protocol | 'default'

export interface Channel {
  id: string
  name: string
  color: string
  servo: {
    protocol: ChannelProtocol
    servoId: number
    nodeId: number
  }
  /** Hard limits in degrees. Every value sent is clamped into these. */
  min: number
  max: number
  /** Where the channel sits with no keyframes, and where it is homed to. */
  rest: number
  /** Fastest the output may move, in degrees per second. 0 means no limit. */
  maxSpeed: number
  invert: boolean
  /** Degrees added at the servo, to centre a mechanism without editing keys. */
  trim: number
  mute: boolean
  solo: boolean
  keys: Keyframe[]
}

export interface Show {
  format: typeof SHOW_FORMAT
  version: typeof SHOW_VERSION
  name: string
  source: Source
  bus: {
    /** The protocol channels set to 'default' use. */
    protocol: Protocol
    /** One adapter runs one bitrate, so this is per show, not per channel. */
    speedCode: number
  }
  /** How often playback sends positions, in hertz. */
  outputHz: number
  channels: Channel[]
}

export const CHANNEL_COLORS = ['#5b76d9', '#e0ba78', '#4ecb71', '#ff5c6b', '#b07be0', '#4fc3d9', '#e08a4f', '#c9d94f']

let counter = 0

export function newId(prefix: string): string {
  counter = (counter + 1) % 1e6
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

export function newChannel(index: number, servo: Partial<Channel['servo']> = {}): Channel {
  return {
    id: newId('c'),
    name: `Channel ${index + 1}`,
    color: CHANNEL_COLORS[index % CHANNEL_COLORS.length]!,
    servo: { protocol: 'default', servoId: index + 1, nodeId: index + 1, ...servo },
    min: -60,
    max: 60,
    rest: 0,
    maxSpeed: 180,
    invert: false,
    trim: 0,
    mute: false,
    solo: false,
    keys: [],
  }
}

/**
 * A copy of a channel, keys and limits included, to sit beside the original.
 *
 * Everything gets fresh ids. The copy moves to the next servo and node IDs
 * no other channel uses, so it never drives the same servo as the original
 * until someone points it there on purpose.
 */
export function duplicateChannel(show: Show, id: string): Channel | null {
  const source = show.channels.find((c) => c.id === id)
  if (!source) return null
  const nextFree = (from: number, used: number[]): number => {
    let n = from + 1
    while (used.includes(n)) n++
    return n
  }
  return {
    ...source,
    id: newId('c'),
    name: `${source.name} copy`,
    color: CHANNEL_COLORS[show.channels.length % CHANNEL_COLORS.length]!,
    servo: {
      ...source.servo,
      servoId: nextFree(source.servo.servoId, show.channels.map((c) => c.servo.servoId)),
      nodeId: nextFree(source.servo.nodeId, show.channels.map((c) => c.servo.nodeId)),
    },
    solo: false,
    keys: source.keys.map((k) => ({ ...k, id: newId('k') })),
  }
}

export function newShow(): Show {
  return {
    format: SHOW_FORMAT,
    version: SHOW_VERSION,
    name: 'Untitled show',
    source: { kind: 'time', durationMs: 30_000, fps: 30, bpm: null },
    bus: { protocol: 'can20a', speedCode: 0 },
    outputHz: 50,
    channels: [newChannel(0)],
  }
}

export function effectiveProtocol(show: Show, channel: Channel): Protocol {
  return channel.servo.protocol === 'default' ? show.bus.protocol : channel.servo.protocol
}

/** Channels that should move: soloed ones if any are, else every unmuted one. */
export function audibleChannels(show: Show): Channel[] {
  const soloed = show.channels.filter((c) => c.solo)
  return soloed.length ? soloed : show.channels.filter((c) => !c.mute)
}

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.t - b.t)
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export class ShowFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShowFormatError'
  }
}

const PROTOCOLS: readonly Protocol[] = ['can20a', 'can20b', 'dronecan']
const EASES: readonly Ease[] = ['linear', 'smooth', 'step']

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * A show from parsed JSON, with every field checked and defaulted.
 *
 * A show file drives hardware, so a missing or mistyped limit must become
 * the safe default rather than undefined, which would compare false against
 * everything and let any value through.
 */
export function parseShow(json: unknown): Show {
  if (typeof json !== 'object' || json === null) throw new ShowFormatError('This is not a show file.')
  const o = json as Record<string, unknown>
  if (o.format !== SHOW_FORMAT) throw new ShowFormatError('This is not a Showtape file.')
  if (num(o.version, 0) > SHOW_VERSION) {
    throw new ShowFormatError(`This show was saved by a newer version (format ${String(o.version)}).`)
  }

  const base = newShow()
  const src = (o.source ?? {}) as Record<string, unknown>
  const bus = (o.bus ?? {}) as Record<string, unknown>
  const channels = Array.isArray(o.channels) ? o.channels : []

  return {
    format: SHOW_FORMAT,
    version: SHOW_VERSION,
    name: typeof o.name === 'string' ? o.name : base.name,
    source: {
      kind: pick(src.kind, ['time', 'audio', 'midi', 'smpte'], 'time'),
      durationMs: Math.max(1000, num(src.durationMs, base.source.durationMs)),
      fps: pick<FrameRate>(src.fps, [24, 25, 30], 30),
      bpm: typeof src.bpm === 'number' && src.bpm > 0 ? src.bpm : null,
    },
    bus: {
      protocol: pick(bus.protocol, PROTOCOLS, base.bus.protocol),
      speedCode: Math.trunc(num(bus.speedCode, base.bus.speedCode)),
    },
    outputHz: Math.min(200, Math.max(1, num(o.outputHz, base.outputHz))),
    channels: channels.map((raw, i) => parseChannel(raw, i)),
  }
}

function parseChannel(raw: unknown, index: number): Channel {
  const base = newChannel(index)
  const c = (raw ?? {}) as Record<string, unknown>
  const servo = (c.servo ?? {}) as Record<string, unknown>
  let min = num(c.min, base.min)
  let max = num(c.max, base.max)
  if (min > max) [min, max] = [max, min]
  const keys = Array.isArray(c.keys) ? c.keys : []
  return {
    id: typeof c.id === 'string' ? c.id : base.id,
    name: typeof c.name === 'string' ? c.name : base.name,
    color: typeof c.color === 'string' ? c.color : base.color,
    servo: {
      protocol: pick(servo.protocol, ['default', ...PROTOCOLS], 'default'),
      servoId: Math.trunc(num(servo.servoId, base.servo.servoId)),
      nodeId: Math.trunc(num(servo.nodeId, base.servo.nodeId)),
    },
    min,
    max,
    rest: Math.min(max, Math.max(min, num(c.rest, base.rest))),
    maxSpeed: Math.max(0, num(c.maxSpeed, base.maxSpeed)),
    invert: c.invert === true,
    trim: num(c.trim, 0),
    mute: c.mute === true,
    solo: c.solo === true,
    keys: sortKeys(
      keys
        .map((k) => (k ?? {}) as Record<string, unknown>)
        .filter((k) => typeof k.t === 'number' && typeof k.v === 'number')
        .map((k) => ({
          id: typeof k.id === 'string' ? k.id : newId('k'),
          t: Math.max(0, k.t as number),
          v: k.v as number,
          ease: pick(k.ease, EASES, 'smooth'),
        }))
    ),
  }
}

export function serializeShow(show: Show): string {
  return JSON.stringify(show, null, 2) + '\n'
}
