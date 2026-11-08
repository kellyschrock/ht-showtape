import { CMD, REG, degreesToPosition, positionDegrees, type Address } from '@ht/protocol'
import type { Bus, Target } from '@ht/services/bus'
import { audibleChannels, effectiveProtocol, type Channel, type Show } from '../show/model'
import { sampleChannel, servoDegrees, slew } from '../show/sample'

/**
 * Sends the show to the servos.
 *
 * Each tick samples every channel that should move, limits how far it may
 * travel since the last tick, and writes the target position. All of a
 * tick's writes go in one bus transaction. If the bus has not finished the
 * previous tick when the next is due, the new one is dropped rather than
 * queued: a late position is worse than a skipped one, and a queue would
 * fall further behind the music with every tick.
 *
 * Nothing on the bus acknowledges a write, so an unchanged position is
 * still resent now and then, in case a frame was lost.
 *
 * A limp channel has its motor released so it can be moved by hand. It is
 * sent nothing; its position is read instead, a few times a second.
 */

/** The part of ht-servo's Bus this needs, so tests can stand in for it. */
export type OutputBus = Pick<Bus, 'run' | 'ensureSpeed' | 'write' | 'tryRead'>

const RESEND_MS = 500
const LIMP_READ_MS = 100
const POSITION_MASK = 16383

export interface OutputStats {
  /** Ticks whose writes reached the bus in the last second. */
  achievedHz: number
  /** Ticks dropped because the bus was still busy, since arming. */
  dropped: number
  /** Writes sent since arming. */
  writes: number
}

export function channelTarget(show: Show, channel: Channel): Target {
  return {
    protocol: effectiveProtocol(show, channel),
    servoId: channel.servo.servoId,
    nodeId: channel.servo.nodeId,
    speedCode: show.bus.speedCode,
  }
}

export interface PlannedWrite {
  channelId: string
  target: Target
  degrees: number
  counts: number
}

/**
 * Where each channel should be told to go at `t`, given where it was last
 * told to go `dtMs` ago. Pure, so the limits can be tested without a bus.
 * Muted channels are left out: they hold wherever they last were.
 */
export function plan(show: Show, t: number, last: ReadonlyMap<string, number>, dtMs: number): PlannedWrite[] {
  return audibleChannels(show).map((channel) => {
    const want = servoDegrees(channel, sampleChannel(channel, t))
    const prev = last.get(channel.id)
    const degrees = prev == null ? want : slew(prev, want, channel.maxSpeed, dtMs)
    return { channelId: channel.id, target: channelTarget(show, channel), degrees, counts: degreesToPosition(degrees) }
  })
}

export class ServoOutput {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private lastDegrees = new Map<string, number>()
  private lastSent = new Map<string, { counts: number; at: number }>()
  private lastTickAt = 0
  private completions: number[] = []
  private stats_: OutputStats = { achievedHz: 0, dropped: 0, writes: 0 }
  private silent_: string[] = []
  private limp = new Set<string>()
  private lastLimpRead = 0

  /** Called with each limp channel's position as it is read, in degrees at the servo. */
  onLimpPosition: ((channelId: string, degrees: number) => void) | null = null

  constructor(
    private readonly bus: OutputBus,
    private readonly getShow: () => Show,
    private readonly getTime: () => number,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly wallClock: () => number = () => performance.now()
  ) {}

  get armed(): boolean {
    return this.timer != null
  }

  get stats(): OutputStats {
    return this.stats_
  }

  /**
   * Names of the channels whose servo did not answer the position read on
   * arming. Usually a channel pointed at an address nothing is on.
   */
  get silent(): readonly string[] {
    return this.silent_
  }

  /** The channels whose motor is released. */
  get limpChannels(): ReadonlySet<string> {
    return this.limp
  }

  /** Where each channel was last told to go, in degrees at the servo. */
  get positions(): ReadonlyMap<string, number> {
    return this.lastDegrees
  }

  /**
   * Starts sending. Each servo's present position is read first, so the
   * speed limit eases it from where it actually is rather than snapping it
   * to the show on the first tick.
   */
  async arm(): Promise<void> {
    if (this.timer) return
    const show = this.getShow()
    this.lastDegrees.clear()
    this.lastSent.clear()
    this.stats_ = { achievedHz: 0, dropped: 0, writes: 0 }
    const silent: string[] = []
    await this.bus.run(async () => {
      for (const channel of show.channels) {
        const target = channelTarget(show, channel)
        await this.bus.ensureSpeed(target.speedCode)
        const counts = await this.bus.tryRead(target, REG.POSITION, { tries: 3 })
        if (counts != null) this.lastDegrees.set(channel.id, positionDegrees(counts & POSITION_MASK))
        else silent.push(channel.name)
      }
    })
    this.silent_ = silent
    this.lastTickAt = this.wallClock()
    this.timer = setInterval(() => this.tick(), 1000 / show.outputHz)
  }

  disarm(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Releases a channel's motor so it can be moved by hand. */
  async goLimp(channelId: string): Promise<void> {
    const show = this.getShow()
    const channel = show.channels.find((c) => c.id === channelId)
    if (!channel || this.limp.has(channelId)) return
    const target = channelTarget(show, channel)
    // Marked first, so no tick sends it a position after the release.
    this.limp.add(channelId)
    try {
      await this.bus.run(async () => {
        await this.bus.ensureSpeed(target.speedCode)
        await this.bus.write(target as Address, REG.POWER_CONTROL, CMD.POWER_FREE)
      })
    } catch (error) {
      this.limp.delete(channelId)
      throw error
    }
  }

  /**
   * Turns a limp channel's motor back on where it now is. Its target is set
   * to that position first, or it would spring back to the last one it was
   * sent.
   */
  async engage(channelId: string): Promise<void> {
    if (!this.limp.has(channelId)) return
    const show = this.getShow()
    const channel = show.channels.find((c) => c.id === channelId)
    if (!channel) {
      this.limp.delete(channelId)
      return
    }
    const target = channelTarget(show, channel)
    await this.bus.run(async () => {
      await this.bus.ensureSpeed(target.speedCode)
      const counts = await this.bus.tryRead(target, REG.POSITION, { tries: 3 })
      if (counts != null) this.lastDegrees.set(channelId, positionDegrees(counts & POSITION_MASK))
      const held = this.lastDegrees.get(channelId)
      if (held != null) {
        const heldCounts = degreesToPosition(held)
        await this.bus.write(target as Address, REG.POS_NEW, heldCounts)
        this.lastSent.set(channelId, { counts: heldCounts, at: this.wallClock() })
      }
      await this.bus.write(target as Address, REG.POWER_CONTROL, CMD.POWER_ON)
    })
    this.limp.delete(channelId)
  }

  /** Engages every limp channel. */
  async engageAll(): Promise<void> {
    for (const id of [...this.limp]) await this.engage(id)
  }

  /** Public for tests; the interval calls it. */
  tick(): void {
    const at = this.wallClock()
    if (this.busy) {
      this.stats_ = { ...this.stats_, dropped: this.stats_.dropped + 1 }
      return
    }
    const dtMs = at - this.lastTickAt
    this.lastTickAt = at
    const show = this.getShow()
    const writes = plan(show, this.getTime(), this.lastDegrees, dtMs).filter((w) => !this.limp.has(w.channelId))
    for (const w of writes) this.lastDegrees.set(w.channelId, w.degrees)

    const due = writes.filter((w) => {
      const sent = this.lastSent.get(w.channelId)
      return !sent || sent.counts !== w.counts || at - sent.at >= RESEND_MS
    })
    const readLimp = this.limp.size > 0 && at - this.lastLimpRead >= LIMP_READ_MS
    if (due.length === 0 && !readLimp) return this.completed(at)
    if (readLimp) this.lastLimpRead = at

    this.busy = true
    void this.bus
      .run(async () => {
        for (const w of due) {
          await this.bus.ensureSpeed(w.target.speedCode)
          await this.bus.write(w.target as Address, REG.POS_NEW, w.counts)
          this.lastSent.set(w.channelId, { counts: w.counts, at })
        }
        if (readLimp) await this.readLimp(show)
      })
      .then(
        () => {
          this.stats_ = { ...this.stats_, writes: this.stats_.writes + due.length }
          this.completed(this.wallClock())
        },
        (error: unknown) => {
          this.disarm()
          this.onError(error)
        }
      )
      .finally(() => {
        this.busy = false
      })
  }

  private async readLimp(show: Show): Promise<void> {
    for (const channel of show.channels) {
      if (!this.limp.has(channel.id)) continue
      const target = channelTarget(show, channel)
      await this.bus.ensureSpeed(target.speedCode)
      const counts = await this.bus.tryRead(target, REG.POSITION, { tries: 1 })
      // Engaged while this read was waiting: the engage has the last word.
      if (counts == null || !this.limp.has(channel.id)) continue
      const degrees = positionDegrees(counts & POSITION_MASK)
      this.lastDegrees.set(channel.id, degrees)
      this.onLimpPosition?.(channel.id, degrees)
    }
  }

  private completed(at: number): void {
    this.completions.push(at)
    while (this.completions.length && at - this.completions[0]! > 1000) this.completions.shift()
    this.stats_ = { ...this.stats_, achievedHz: this.completions.length }
  }
}
