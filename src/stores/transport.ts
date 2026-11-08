import { create } from 'zustand'
import { getBus, onBusChange } from '@ht/stores/connection'
import { InternalClock, type Clock } from '../clock/clock'
import { ServoOutput, type OutputStats } from '../playback/output'
import type { Pose, Show } from '../show/model'
import { holdPose, poseName, resolveShow } from '../show/poses'
import { channelDegrees, roundDegrees } from '../show/sample'
import { heldPose, usePoses } from './poses'
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
 *
 * While a pose is held, a servo can be made limp and moved by hand; the
 * pose follows it. Anything that ends the hold engages it again where it
 * was left, so no servo stays limp unnoticed.
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
  /** Channels whose servo did not answer when the output was armed. */
  silent: readonly string[]
  /** Channel ids whose motor is released for moving by hand. */
  limp: readonly string[]

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
  goLimp(channelId: string): Promise<void>
  engage(channelId: string): Promise<void>
}

export const MIN_ZOOM = 10
export const MAX_ZOOM = 1000

const clock: Clock = new InternalClock()

/** Where the show is right now, read from the clock as output does, not from the last frame's playhead. */
export function showTime(): number {
  return clock.now()
}
let held: { show: Show; pose: Pose; out: Show } | null = null

/**
 * The show as the servos get it: cues turned into keys, and while a pose is
 * being shaped, the figure holding that pose. Output and the monitor both
 * read this, so they always agree.
 */
export function playbackShow(): Show {
  const show = resolveShow(useShow.getState().show)
  const pose = heldPose()
  if (!pose) return show
  if (held?.show !== show || held.pose !== pose) held = { show, pose, out: holdPose(show, pose) }
  return held.out
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
    set({ armed: false, arming: false, stats: null, silent: [], limp: [], outputError: error })
  }

  function syncLimp(): void {
    set({ limp: output ? [...output.limpChannels] : [] })
  }

  /** A limp servo moved by hand moves the held pose with it. */
  function followHand(channelId: string, degrees: number): void {
    const pose = heldPose()
    const channel = playbackShow().channels.find((c) => c.id === channelId)
    if (!pose || !channel || pose.values[poseName(channel)] == null) return
    usePoses.getState().setValue(pose.id, poseName(channel), roundDegrees(channelDegrees(channel, degrees)))
  }

  function engageAll(): Promise<void> {
    const current = output
    if (!current || current.limpChannels.size === 0) return Promise.resolve()
    return current.engageAll().then(syncLimp, (error: unknown) => {
      syncLimp()
      set({ outputError: error instanceof Error ? error.message : String(error) })
    })
  }

  // Ending the hold, or holding a different pose, engages every limp servo.
  usePoses.subscribe((now, before) => {
    if (!now.posing || now.editingId !== before.editingId) void engageAll()
  })

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
    silent: [],
    limp: [],

    play() {
      // Playing hands the figure back to the timeline.
      usePoses.getState().setPosing(false)
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
        playbackShow,
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
      next.onLimpPosition = followHand
      output = next
      set({ armed: true, arming: false, stats: next.stats, silent: next.silent })
      statsTimer = setInterval(() => {
        if (output) set({ stats: output.stats })
      }, 250)
    },

    disarm() {
      // Limp servos are engaged where they are before the output lets go.
      void engageAll().then(() => stopOutput())
    },

    async goLimp(channelId) {
      if (!output || !heldPose()) return
      try {
        await output.goLimp(channelId)
      } catch (error) {
        set({ outputError: error instanceof Error ? error.message : String(error) })
      }
      syncLimp()
    },

    async engage(channelId) {
      if (!output) return
      try {
        await output.engage(channelId)
      } catch (error) {
        set({ outputError: error instanceof Error ? error.message : String(error) })
      }
      syncLimp()
    },
  }
})
