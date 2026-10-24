import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { degreesToPosition, positionDegrees } from '@ht/protocol'
import { newChannel, newShow } from '../show/model'
import type { OutputBus } from '../playback/output'
import { Player } from './player'

function showWith(...keys: Array<[number, number]>) {
  const show = newShow()
  show.source.durationMs = 1000
  show.channels = [{ ...newChannel(0), keys: keys.map(([t, v], i) => ({ id: `${i}`, t, v, ease: 'linear' as const })) }]
  return show
}

function fakeBus(degrees: number | null) {
  const writes: Array<{ servoId: number; degrees: number }> = []
  const bus: OutputBus = {
    run: (work) => work(),
    ensureSpeed: vi.fn(async () => {}),
    write: vi.fn(async (to, _addr, value) => {
      writes.push({ servoId: to.servoId, degrees: positionDegrees(value) })
    }),
    tryRead: vi.fn(async () => (degrees == null ? null : degreesToPosition(degrees))),
  }
  return { bus, writes }
}

/** The biggest move between two writes to one servo. */
function biggestStep(writes: ReadonlyArray<{ degrees: number }>): number {
  let most = 0
  for (let i = 1; i < writes.length; i++) most = Math.max(most, Math.abs(writes[i]!.degrees - writes[i - 1]!.degrees))
  return most
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Player', () => {
  it('eases to the first pose, plays, then eases back to rest', async () => {
    const show = showWith([0, 20], [1000, 40])
    const { bus, writes } = fakeBus(0)
    const player = new Player(bus, show, { homeSpeed: 60 })
    const played = player.play()

    // 20 degrees at 60 deg/s takes a third of a second; nothing has played yet.
    await vi.advanceTimersByTimeAsync(200)
    expect(player.state).toBe('homing')
    expect(player.runs).toBe(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(player.state).toBe('playing')

    await vi.advanceTimersByTimeAsync(3000)
    await played
    expect(player.state).toBe('idle')
    expect(writes.some((w) => w.degrees >= 39)).toBe(true)
    expect(writes.at(-1)!.degrees).toBeCloseTo(0, 1)
    // Homing and resting never move faster than 60 deg/s at 50 Hz.
    expect(biggestStep(writes)).toBeLessThanOrEqual(60 / 50 + 0.1)
  })

  it('loops until stopped, then comes to rest', async () => {
    const show = showWith([0, 0], [1000, 10])
    const { bus, writes } = fakeBus(0)
    const player = new Player(bus, show, { loop: true, gapMs: 200, homeSpeed: 60 })
    const played = player.play()

    await vi.advanceTimersByTimeAsync(3000)
    expect(player.runs).toBeGreaterThanOrEqual(3)
    expect(player.state).not.toBe('idle')

    const stopped = player.stop()
    await vi.advanceTimersByTimeAsync(1000)
    await stopped
    await played
    expect(player.state).toBe('idle')
    expect(writes.at(-1)!.degrees).toBeCloseTo(0, 1)
  })

  it('can be stopped while still homing', async () => {
    const show = showWith([0, 60])
    const { bus } = fakeBus(0)
    const player = new Player(bus, show, { homeSpeed: 10 })
    const played = player.play()
    await vi.advanceTimersByTimeAsync(500)
    const stopped = player.stop()
    await vi.advanceTimersByTimeAsync(2000)
    await stopped
    await played
    expect(player.runs).toBe(0)
    expect(player.state).toBe('idle')
  })

  it('plays every channel even when the show was saved with one soloed', async () => {
    const show = showWith([0, 0])
    show.channels.push({ ...newChannel(1), solo: true })
    const { bus, writes } = fakeBus(0)
    const log: string[] = []
    const player = new Player(bus, show, { log: (m) => log.push(m) })
    const played = player.play()
    await vi.advanceTimersByTimeAsync(3000)
    await played
    expect(new Set(writes.map((w) => w.servoId))).toEqual(new Set([1, 2]))
    expect(log.some((m) => m.includes('Solo'))).toBe(true)
  })

  it('fails when the bus does', async () => {
    const show = showWith([0, 0])
    const { bus } = fakeBus(0)
    bus.write = vi.fn(async () => {
      throw new Error('adapter gone')
    })
    const player = new Player(bus, show)
    const played = player.play()
    const outcome = expect(played).rejects.toThrow('adapter gone')
    await vi.advanceTimersByTimeAsync(500)
    await outcome
    expect(player.state).toBe('idle')
  })
})
