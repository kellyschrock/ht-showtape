import { describe, expect, it } from 'vitest'
import { formatSeconds, formatTimecode, parseSeconds, snap, snapStep } from './timecode'

describe('timecode', () => {
  it('formats non-drop timecode', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(3_723_500, 30)).toBe('01:02:03:15')
    expect(formatTimecode(1000 / 25, 25)).toBe('00:00:00:01')
  })

  it('formats and parses seconds', () => {
    expect(formatSeconds(83_250)).toBe('1:23.250')
    expect(parseSeconds('1:23.25')).toBe(83_250)
    expect(parseSeconds('2.5')).toBe(2500)
    expect(parseSeconds('abc')).toBeNull()
  })

  it('snaps to beats when there is a tempo, frames when not', () => {
    expect(snapStep(25, null)).toBe(40)
    expect(snapStep(30, 120)).toBe(125)
    expect(snap(130, 125)).toBe(125)
  })
})
