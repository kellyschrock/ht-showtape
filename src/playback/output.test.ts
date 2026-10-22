import { describe, expect, it, vi } from 'vitest'
import { degreesToPosition } from '@ht/protocol'
import { newChannel, newShow } from '../show/model'
import { plan, ServoOutput, type OutputBus } from './output'

function showWith(...keys: Array<[number, number]>) {
  const show = newShow()
  show.channels = [{ ...newChannel(0), maxSpeed: 100, keys: keys.map(([t, v], i) => ({ id: `${i}`, t, v, ease: 'linear' as const })) }]
  return show
}

describe('plan', () => {
  it('sends the curve as is on the first tick, then limits the speed', () => {
    const show = showWith([0, 0], [100, 50])
    const first = plan(show, 100, new Map(), 20)
    expect(first[0]!.degrees).toBe(50)
    const limited = plan(show, 100, new Map([[show.channels[0]!.id, 0]]), 100)
    expect(limited[0]!.degrees).toBeCloseTo(10)
  })

  it('addresses each channel with its own protocol, or the show default', () => {
    const show = showWith()
    show.bus.protocol = 'can20b'
    show.channels.push({ ...newChannel(1), servo: { protocol: 'dronecan', servoId: 4, nodeId: 0 } })
    const [a, b] = plan(show, 0, new Map(), 20)
    expect(a!.target.protocol).toBe('can20b')
    expect(b!.target).toMatchObject({ protocol: 'dronecan', servoId: 4 })
  })
})

function fakeBus(position: number | null) {
  const writes: Array<{ servoId: number; addr: number; value: number }> = []
  const bus: OutputBus = {
    run: (work) => work(),
    ensureSpeed: vi.fn(async () => {}),
    write: vi.fn(async (to, addr, value) => {
      writes.push({ servoId: to.servoId, addr, value })
    }),
    tryRead: vi.fn(async () => position),
  }
  return { bus, writes }
}

/** Lets a tick's bus transaction and its bookkeeping finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ServoOutput', () => {
  it('eases from the position it reads on arming', async () => {
    const show = showWith([0, 60])
    let wall = 0
    const { bus, writes } = fakeBus(degreesToPosition(0))
    const out = new ServoOutput(bus, () => show, () => 0, undefined, () => wall)
    await out.arm()
    wall = 100
    out.disarm()
    out.tick()
    await settle()
    // 100 deg/s for 100 ms from 0 is 10 degrees, not the 60 the show asks for.
    expect(writes.at(-1)!.value).toBe(degreesToPosition(10))
  })

  it('does not resend an unchanged position until the resend interval', async () => {
    const show = showWith([0, 0])
    let wall = 0
    const { bus, writes } = fakeBus(null)
    const out = new ServoOutput(bus, () => show, () => 0, undefined, () => wall)
    out.tick()
    await settle()
    wall = 20
    out.tick()
    await settle()
    expect(writes).toHaveLength(1)
    wall = 600
    out.tick()
    await settle()
    expect(writes).toHaveLength(2)
  })
})
