import { InternalClock, type Clock } from '../clock/clock'
import { audibleChannels, type Show } from '../show/model'
import { sampleChannel, servoDegrees } from '../show/sample'
import { ServoOutput, type OutputBus } from '../playback/output'

/**
 * Plays a finished show on the figure, with nobody at a screen.
 *
 * It sends through the same ServoOutput as the editor's Servos live, so a
 * show moves the figure exactly as it did while it was being made. What it
 * adds is what an unattended figure needs around the show itself:
 *
 * - It eases every servo to the show's first pose before starting, slowly,
 *   from wherever the servos were left. A figure powered up mid-gesture
 *   should not snap.
 * - It eases them back to rest when it is stopped, before letting go.
 * - It loops, with a pause between runs if asked.
 *
 * Solo is ignored: it is an editing aid, and a show saved with one channel
 * soloed should still move the whole figure. Mute is kept, since muting a
 * channel is how a show leaves out a servo that is not fitted.
 */

export interface PlayerOptions {
  /** Start again when the show ends. */
  loop?: boolean
  /** Pause between runs when looping, in milliseconds. */
  gapMs?: number
  /** The fastest homing and resting may move a servo, in degrees per second. */
  homeSpeed?: number
  log?: (message: string) => void
}

/**
 * How close counts as arrived. The speed limit lands exactly on its target,
 * so this only absorbs rounding; any looser and the figure stops short.
 */
const ARRIVED_DEG = 1e-6
const WATCH_MS = 20

type Phase = 'idle' | 'homing' | 'playing' | 'gap' | 'resting'

/** The show with every channel slowed to `speed` at most, for moving to and from it. */
function gentle(show: Show, speed: number): Show {
  return {
    ...show,
    channels: show.channels.map((c) => ({ ...c, maxSpeed: c.maxSpeed > 0 ? Math.min(c.maxSpeed, speed) : speed })),
  }
}

/** The show with every channel at rest: no keys, so each samples its rest value. */
function atRest(show: Show): Show {
  return { ...show, channels: show.channels.map((c) => ({ ...c, keys: [] })) }
}

export class Player {
  private readonly show: Show
  private readonly output: ServoOutput
  private readonly clock: Clock = new InternalClock()
  private readonly options: Required<PlayerOptions>
  private phase: Phase = 'idle'
  private watch: ReturnType<typeof setInterval> | null = null
  private failure: unknown = null
  private settle: (() => void) | null = null
  private finished: (() => void) | null = null
  /** How many times the show has started. */
  runs = 0

  constructor(bus: OutputBus, show: Show, options: PlayerOptions = {}) {
    this.options = { loop: false, gapMs: 0, homeSpeed: 30, log: () => {}, ...options }
    if (show.channels.some((c) => c.solo)) this.options.log('Solo is set in this show; playing every channel anyway.')
    this.show = { ...show, channels: show.channels.map((c) => ({ ...c, solo: false })) }

    const toStart = gentle(this.show, this.options.homeSpeed)
    const toRest = gentle(atRest(this.show), this.options.homeSpeed)
    this.output = new ServoOutput(
      bus,
      () => (this.phase === 'homing' ? toStart : this.phase === 'resting' ? toRest : this.show),
      () => (this.phase === 'playing' || this.phase === 'gap' ? this.clock.now() : 0),
      (error) => this.fail(error)
    )
  }

  get state(): Phase {
    return this.phase
  }

  /**
   * Homes the figure and plays. Resolves when a show that does not loop has
   * ended, or when stop() has brought the figure to rest. Rejects if the
   * bus fails.
   */
  async play(): Promise<void> {
    const done = new Promise<void>((resolve) => (this.finished = resolve))
    this.phase = 'homing'
    await this.output.arm()
    const unread = this.show.channels.filter((c) => !this.output.positions.has(c.id))
    for (const c of unread) {
      this.options.log(`Could not read where ${c.name} is (servo ${c.servo.servoId}); it may jump to its first pose.`)
    }
    this.options.log('Moving to the first pose')
    await this.arrive()
    if (this.phase !== 'homing') return this.outcome(done)

    this.start()
    this.watch = setInterval(() => this.tick(), WATCH_MS)
    return this.outcome(done)
  }

  /** Eases the figure to rest and lets go of the servos. Safe to call at any point. */
  async stop(): Promise<void> {
    if (this.phase === 'idle' || this.phase === 'resting') return
    this.clearWatch()
    this.clock.pause()
    // Stopped while homing: that wait gives way to this one.
    this.settle?.()
    if (this.output.armed) {
      this.phase = 'resting'
      this.options.log('Moving to rest')
      await this.arrive()
    }
    this.end()
  }

  private start(): void {
    this.runs++
    this.options.log(this.runs === 1 ? 'Playing' : `Playing (run ${this.runs})`)
    this.phase = 'playing'
    this.clock.seek(0)
    this.clock.play()
  }

  private tick(): void {
    if (this.phase !== 'playing') return
    if (this.clock.now() < this.show.source.durationMs) return
    this.clock.pause()
    this.clock.seek(this.show.source.durationMs)
    if (!this.options.loop) {
      this.options.log('Show ended')
      void this.stop()
      return
    }
    // Held on the last pose through the gap, then round again.
    this.phase = 'gap'
    setTimeout(() => {
      if (this.phase === 'gap') this.start()
    }, this.options.gapMs)
  }

  /** Waits until every servo has reached where the current phase wants it, or the bus fails. */
  private arrive(): Promise<void> {
    const show = this.phase === 'resting' ? atRest(this.show) : this.show
    const wanted = new Map(audibleChannels(show).map((c) => [c.id, servoDegrees(c, sampleChannel(c, 0))]))
    return new Promise((resolve) => {
      const check = () => {
        if (!this.output.armed) return done()
        for (const [id, want] of wanted) {
          const at = this.output.positions.get(id)
          if (at == null || Math.abs(at - want) > ARRIVED_DEG) return
        }
        done()
      }
      const timer = setInterval(check, WATCH_MS)
      const done = () => {
        clearInterval(timer)
        this.settle = null
        resolve()
      }
      this.settle = done
      check()
    })
  }

  private fail(error: unknown): void {
    this.failure = error
    this.clearWatch()
    this.settle?.()
    this.end()
  }

  private end(): void {
    this.output.disarm()
    this.phase = 'idle'
    this.finished?.()
  }

  private clearWatch(): void {
    if (this.watch) clearInterval(this.watch)
    this.watch = null
  }

  private async outcome(done: Promise<void>): Promise<void> {
    await done
    if (this.failure != null) throw this.failure
  }
}
