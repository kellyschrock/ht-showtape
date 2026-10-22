import { describe, expect, it } from 'vitest'
import { audibleChannels, duplicateChannel, newChannel, newShow, parseShow, serializeShow, ShowFormatError } from './model'

describe('show files', () => {
  it('round-trips', () => {
    const show = newShow()
    show.channels[0]!.keys = [{ id: 'a', t: 100, v: 12, ease: 'linear' }]
    expect(parseShow(JSON.parse(serializeShow(show)))).toEqual(show)
  })

  it('rejects files that are not shows, and newer formats', () => {
    expect(() => parseShow({ format: 'other' })).toThrow(ShowFormatError)
    expect(() => parseShow({ ...newShow(), version: 99 })).toThrow(/newer/)
  })

  it('fills missing limits with safe defaults rather than undefined', () => {
    const show = parseShow({ format: 'hitec-showtape', version: 1, channels: [{ min: 'x', keys: [{ t: 5, v: 1 }] }] })
    const c = show.channels[0]!
    expect(c.min).toBe(-60)
    expect(c.max).toBe(60)
    expect(c.keys[0]!.ease).toBe('smooth')
  })

  it('swaps reversed limits and sorts keys', () => {
    const show = parseShow({
      format: 'hitec-showtape',
      version: 1,
      channels: [{ min: 40, max: -40, keys: [{ t: 200, v: 1 }, { t: 100, v: 2 }] }],
    })
    expect(show.channels[0]!.min).toBe(-40)
    expect(show.channels[0]!.keys.map((k) => k.t)).toEqual([100, 200])
  })
})

describe('audibleChannels', () => {
  it('plays soloed channels only when any are soloed, else all unmuted', () => {
    const show = newShow()
    show.channels = [newChannel(0), { ...newChannel(1), mute: true }, newChannel(2)]
    expect(audibleChannels(show)).toHaveLength(2)
    show.channels[2]!.solo = true
    expect(audibleChannels(show).map((c) => c.name)).toEqual(['Channel 3'])
  })
})

describe('duplicateChannel', () => {
  it('copies keys and limits with fresh ids, on a free servo', () => {
    const show = newShow()
    show.channels = [
      { ...newChannel(0), min: -30, max: 45, solo: true, keys: [{ id: 'a', t: 100, v: 12, ease: 'linear' }] },
      newChannel(1),
    ]
    const copy = duplicateChannel(show, show.channels[0]!.id)!
    const source = show.channels[0]!
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Channel 1 copy')
    expect([copy.min, copy.max, copy.solo]).toEqual([-30, 45, false])
    expect(copy.keys.map(({ t, v, ease }) => ({ t, v, ease }))).toEqual([{ t: 100, v: 12, ease: 'linear' }])
    expect(copy.keys[0]!.id).not.toBe('a')
    expect(copy.servo.servoId).toBe(3)
    expect(copy.servo.nodeId).toBe(3)
  })

  it('returns null for a channel that is not there', () => {
    expect(duplicateChannel(newShow(), 'nope')).toBeNull()
  })
})
