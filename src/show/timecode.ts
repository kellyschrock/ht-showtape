import type { FrameRate } from './model'

/** Times on the timeline are milliseconds from zero; these are the ways of showing them. */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** HH:MM:SS:FF, non-drop. */
export function formatTimecode(ms: number, fps: FrameRate): string {
  const totalFrames = Math.floor((Math.max(0, ms) * fps) / 1000 + 1e-6)
  const ff = totalFrames % fps
  const totalSeconds = Math.floor(totalFrames / fps)
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(ff)}`
}

/** M:SS.mmm, for the inspector and the ruler's fine marks. */
export function formatSeconds(ms: number): string {
  const v = Math.max(0, Math.round(ms))
  const minutes = Math.floor(v / 60000)
  const seconds = Math.floor(v / 1000) % 60
  return `${minutes}:${pad(seconds)}.${pad(v % 1000, 3)}`
}

/** Parses M:SS.mmm, SS.mmm or plain seconds. Null if it is not a time. */
export function parseSeconds(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d*)?)\s*$/.exec(text)
  if (!m) return null
  const minutes = m[1] ? Number(m[1]) : 0
  return Math.round((minutes * 60 + Number(m[2])) * 1000)
}

/** The snapping step in ms: a beat subdivision when there is a tempo, else a frame. */
export function snapStep(fps: FrameRate, bpm: number | null, division = 4): number {
  return bpm ? 60000 / bpm / division : 1000 / fps
}

export function snap(ms: number, step: number): number {
  return step > 0 ? Math.round(ms / step) * step : ms
}
