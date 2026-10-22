import { create } from 'zustand'
import { getBus, onBusChange } from '@ht/stores/connection'
import { InternalClock, type Clock } from '../clock/clock'
import { ServoOutput, type OutputStats } from '../playback/output'
import { useShow } from './show'

/**
 * Play, pause, seek, and whether the servos follow.
 *
 * The clock owns the time. This store only reads it once a frame for the
 * screen, so the playhead and the servos never disagree about where the
 * show is: the output asks the same clock when it sends.
 *
 * Output keeps running while paused, so scrubbing or nudging a key moves
 * the servos too. That is how a show gets built against the real figure.
 */

interface TransportState {
  playing: boolean
  positionMs: number
  loop: boolean
  /** Pixels per second on the timeline. */
  zoom: number
  snap: boolean

  armed: boolean
  arming: boolean
  outputError: string | null
  stats: OutputStats | null

  play(): void
  pause(): void
  toggle(): void
  stop(): void
  seek(ms: number): void
  setLoop(loop: boolean): void
  setZoom(zoom: number): void
  setSnap(snap: boolean): void
  arm(): Promise<void>
  disarm(): void
}

export const MIN_ZOOM = 10
export const MAX_ZOOM = 1000

const clock: Clock = new InternalClock()

/** Where the show is right now, read from the clock as output does, not from the last frame's playhead. */
export function showTime(): number {
  return clock.now()
}
let output: ServoOutput | null = null
let frame = 0
let statsTimer: ReturnType<typeof setInterval> | null = null

function duration(): number {
  return useShow.getState().show.source.durationMs
}

export const useTransport = create<TransportState>((set, get) => {
  function onFrame(): void {
    let t = clock.now()
    const end = duration()
    if (t >= end) {
      if (get().loop) {
        clock.seek(0)
        t = 0
      } else {
        clock.pause()
        clock.seek(end)
        t = end
        set({ playing: false, positionMs: t })
        return
      }
    }
    set({ positionMs: t })
    frame = requestAnimationFrame(onFrame)
  }

  function stopOutput(error: string | null = null): void {
    output?.disarm()
    output = null
    if (statsTimer) clearInterval(statsTimer)
    statsTimer = null
    set({ armed: false, arming: false, stats: null, outputError: error })
  }

  // The adapter going away takes the output with it.
  onBusChange((bus) => {
    if (!bus && output) stopOutput('The adapter disconnected.')
  })

  return {
    playing: false,
    positionMs: 0,
    loop: false,
    zoom: 80,
    snap: true,

    armed: false,
    arming: false,
    outputError: null,
    stats: null,

    play() {
      if (clock.now() >= duration()) clock.seek(0)
      clock.play()
      set({ playing: true })
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(onFrame)
    },

    pause() {
      clock.pause()
      cancelAnimationFrame(frame)
      set({ playing: false, positionMs: clock.now() })
    },

    toggle() {
      if (get().playing) get().pause()
      else get().play()
    },

    stop() {
      get().pause()
      get().seek(0)
    },

    seek(ms) {
      const t = Math.min(Math.max(0, ms), duration())
      clock.seek(t)
      set({ positionMs: t })
    },

    setLoop(loop) {
      set({ loop })
    },

    setZoom(zoom) {
      set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) })
    },

    setSnap(snap) {
      set({ snap })
    },

    async arm() {
      const bus = getBus()
      if (!bus || output || get().arming) return
      set({ arming: true, outputError: null })
      const next = new ServoOutput(
        bus,
        () => useShow.getState().show,
        () => clock.now(),
        (error) => stopOutput(error instanceof Error ? error.message : String(error))
      )
      try {
        await next.arm()
      } catch (error) {
        next.disarm()
        set({ arming: false, outputError: error instanceof Error ? error.message : String(error) })
        return
      }
      output = next
      set({ armed: true, arming: false, stats: next.stats })
      statsTimer = setInterval(() => {
        if (output) set({ stats: output.stats })
      }, 250)
    },

    disarm() {
      stopOutput()
    },
  }
})
