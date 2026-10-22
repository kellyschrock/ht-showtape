import { describe, expect, it } from 'vitest'
import { audibleChannels, newChannel, newShow, parseShow, serializeShow, ShowFormatError } from './model'

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
