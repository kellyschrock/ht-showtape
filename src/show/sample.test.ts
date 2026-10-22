import { describe, expect, it } from 'vitest'
import { clamp, sampleChannel, sampleKeys, servoDegrees, slew } from './sample'
import { newChannel, type Keyframe } from './model'

const k = (t: number, v: number, ease: Keyframe['ease'] = 'linear'): Keyframe => ({ id: `${t}`, t, v, ease })

describe('sampleKeys', () => {
  it('returns rest with no keys', () => {
    expect(sampleKeys([], 500, 7)).toBe(7)
  })

  it('holds the first and last values outside the keys', () => {
    const keys = [k(1000, 10), k(2000, 20)]
    expect(sampleKeys(keys, 0, 0)).toBe(10)
    expect(sampleKeys(keys, 5000, 0)).toBe(20)
  })

  it('interpolates linearly', () => {
    expect(sampleKeys([k(0, 0), k(1000, 100)], 250, 0)).toBe(25)
  })

  it('holds until the next key on step', () => {
    const keys = [k(0, 0, 'step'), k(1000, 100)]
    expect(sampleKeys(keys, 999, 0)).toBe(0)
    expect(sampleKeys(keys, 1000, 0)).toBe(100)
  })

  it('eases in and out on smooth, through the midpoint', () => {
    const keys = [k(0, 0, 'smooth'), k(1000, 100)]
    expect(sampleKeys(keys, 500, 0)).toBeCloseTo(50)
    expect(sampleKeys(keys, 100, 0)).toBeLessThan(10)
    expect(sampleKeys(keys, 900, 0)).toBeGreaterThan(90)
  })

  it('finds the right segment among many', () => {
    const keys = Array.from({ length: 50 }, (_, i) => k(i * 100, i))
    expect(sampleKeys(keys, 2350, 0)).toBeCloseTo(23.5)
  })
})

describe('limits', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
  })

  it('clamps a sampled channel to its range', () => {
    const c = { ...newChannel(0), min: -30, max: 30, keys: [k(0, 90)] }
    expect(sampleChannel(c, 0)).toBe(30)
  })

  it('applies invert after the limits, then trim', () => {
    const c = { ...newChannel(0), min: -30, max: 30, invert: true, trim: 5 }
    expect(servoDegrees(c, 90)).toBe(-25)
  })

  it('slews no faster than the speed limit', () => {
    expect(slew(0, 100, 90, 100)).toBeCloseTo(9)
    expect(slew(0, -100, 90, 100)).toBeCloseTo(-9)
    expect(slew(0, 5, 90, 100)).toBe(5)
    expect(slew(0, 100, 0, 100)).toBe(100)
  })
})
