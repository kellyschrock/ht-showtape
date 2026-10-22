import { describe, expect, it } from 'vitest'
import { newChannel, newShow } from '../show/model'
import { ServoMonitor } from './monitor'

function showWith(...keys: Array<[number, number]>) {
  const show = newShow()
  show.channels = [{ ...newChannel(0), maxSpeed: 100, keys: keys.map(([t, v], i) => ({ id: `${i}`, t, v, ease: 'linear' as const })) }]
  return show
}

describe('ServoMonitor', () => {
  it('starts on the curve, then lags it where the speed limit holds it back', () => {
    const show = showWith([0, 0], [100, 50])
    const monitor = new ServoMonitor()
    expect(monitor.step(show, 0, 16)[0]).toMatchObject({ degrees: 0, lagging: false })
    const after = monitor.step(show, 100, 100)[0]!
    expect(after.degrees).toBeCloseTo(10)
    expect(after.wanted).toBe(50)
    expect(after.lagging).toBe(true)
  })

  it('applies invert and trim, as the servo would see them', () => {
    const show = showWith([0, 20])
    show.channels[0] = { ...show.channels[0]!, invert: true, trim: 5 }
    expect(new ServoMonitor().step(show, 0, 16)[0]!.degrees).toBe(-15)
  })

  it('holds a muted channel where it was', () => {
    const show = showWith([0, 0], [1000, 50])
    const monitor = new ServoMonitor()
    monitor.step(show, 0, 16)
    show.channels[0] = { ...show.channels[0]!, mute: true }
    const held = monitor.step(show, 1000, 1000)[0]!
    expect(held).toMatchObject({ degrees: 0, holding: true, lagging: false })
  })
})
