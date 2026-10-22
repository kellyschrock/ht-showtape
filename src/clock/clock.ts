/**
 * What the timeline is synchronised to.
 *
 * Every source is a clock: something that can say where in the show we are
 * now. Plain time is the first. An audio file's playhead, MIDI timecode and
 * SMPTE will be the others; a chasing source (timecode from outside) will
 * ignore play and seek and report what it hears instead, which is why the
 * transport asks the clock for the time rather than counting itself.
 */
export interface Clock {
  readonly kind: string
  /** Position on the timeline in milliseconds. */
  now(): number
  readonly running: boolean
  play(): void
  pause(): void
  seek(ms: number): void
}

/** Wall-clock time from the moment play was pressed. */
export class InternalClock implements Clock {
  readonly kind = 'time'
  private origin = 0
  private held = 0
  running = false

  constructor(private readonly timeSource: () => number = () => performance.now()) {}

  now(): number {
    return this.running ? this.timeSource() - this.origin : this.held
  }

  play(): void {
    if (this.running) return
    this.origin = this.timeSource() - this.held
    this.running = true
  }

  pause(): void {
    if (!this.running) return
    this.held = this.now()
    this.running = false
  }

  seek(ms: number): void {
    const t = Math.max(0, ms)
    if (this.running) this.origin = this.timeSource() - t
    else this.held = t
  }
}
