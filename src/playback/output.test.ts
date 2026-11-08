import { describe, expect, it, vi } from 'vitest'
import { CMD, REG, degreesToPosition } from '@ht/protocol'
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

  it('names the channels whose servo did not answer on arming', async () => {
    const show = showWith([0, 0])
    show.channels.push({ ...newChannel(1), name: 'Jaw' })
    const { bus } = fakeBus(null)
    vi.mocked(bus.tryRead).mockResolvedValueOnce(degreesToPosition(0))
    const out = new ServoOutput(bus, () => show, () => 0)
    await out.arm()
    out.disarm()
    expect(out.silent).toEqual(['Jaw'])
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

  describe('limp', () => {
    async function armedLimp(position: number) {
      const show = showWith([0, 20])
      const id = show.channels[0]!.id
      let wall = 0
      const { bus, writes } = fakeBus(position)
      const out = new ServoOutput(bus, () => show, () => 0, undefined, () => wall)
      await out.arm()
      out.disarm()
      await out.goLimp(id)
      return { show, id, out, writes, bus, advance: (ms: number) => (wall += ms) }
    }

    it('releases the motor and sends no positions while limp', async () => {
      const { out, writes, advance } = await armedLimp(degreesToPosition(0))
      expect(writes).toEqual([{ servoId: 1, addr: REG.POWER_CONTROL, value: CMD.POWER_FREE }])
      advance(200)
      out.tick()
      await settle()
      expect(writes.filter((w) => w.addr === REG.POS_NEW)).toHaveLength(0)
    })

    it('reports where the hand has moved it', async () => {
      const { out, id, bus, advance } = await armedLimp(degreesToPosition(0))
      const seen: Array<[string, number]> = []
      out.onLimpPosition = (channelId, degrees) => seen.push([channelId, degrees])
      vi.mocked(bus.tryRead).mockResolvedValue(degreesToPosition(33))
      advance(200)
      out.tick()
      await settle()
      expect(seen).toHaveLength(1)
      expect(seen[0]![0]).toBe(id)
      expect(seen[0]![1]).toBeCloseTo(33, 0)
    })

    it('engages where it was left: the target first, then the motor', async () => {
      const { out, id, bus, writes } = await armedLimp(degreesToPosition(0))
      vi.mocked(bus.tryRead).mockResolvedValue(degreesToPosition(-15))
      await out.engage(id)
      expect(writes.slice(-2)).toEqual([
        { servoId: 1, addr: REG.POS_NEW, value: degreesToPosition(-15) },
        { servoId: 1, addr: REG.POWER_CONTROL, value: CMD.POWER_ON },
      ])
      expect(out.limpChannels.size).toBe(0)
    })

    it('is not left marked limp when the release fails', async () => {
      const show = showWith([0, 0])
      const { bus } = fakeBus(null)
      vi.mocked(bus.write).mockRejectedValueOnce(new Error('gone'))
      const out = new ServoOutput(bus, () => show, () => 0)
      await expect(out.goLimp(show.channels[0]!.id)).rejects.toThrow('gone')
      expect(out.limpChannels.size).toBe(0)
    })
  })
})
