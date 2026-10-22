import { describe, expect, it } from 'vitest'
import { InternalClock } from './clock'

describe('InternalClock', () => {
  it('runs from where it was paused and seeks while running or held', () => {
    let wall = 1000
    const clock = new InternalClock(() => wall)
    expect(clock.now()).toBe(0)
    clock.play()
    wall += 500
    expect(clock.now()).toBe(500)
    clock.pause()
    wall += 10_000
    expect(clock.now()).toBe(500)
    clock.seek(2000)
    clock.play()
    wall += 250
    expect(clock.now()).toBe(2250)
    clock.seek(100)
    expect(clock.now()).toBe(100)
  })
})
