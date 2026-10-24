/**
 * showtape-play: plays a finished show on the figure, with no screen.
 *
 * Meant for a small Linux box such as a Raspberry Pi with the DPC-20
 * adapter on USB, run as a service. Ctrl+C or SIGTERM (systemctl stop)
 * eases the figure to rest before exiting; a second one exits at once.
 */

import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { Bus } from '../../ht-servo/src/services/bus'
import { FakeLink, FAKE_PORT_ID } from '../../ht-servo/src/transport/fake-link'
import type { Link } from '../../ht-servo/src/transport/link'
import { REPORT_OFF, raiseDtrAfterDetect } from '../../ht-servo/src/protocol'
import { parseShow } from '../src/show/model'
import { Player } from '../src/player/player'
import { NodeSerialLink } from './serial-link'

const USAGE = `Usage: showtape-play <show.showtape> [options]

Options:
  --port <path>         Serial port of the DPC-20 (default: the first that looks like one)
  --loop                Play again each time the show ends
  --gap <seconds>       Pause between runs when looping (default 0)
  --home-speed <deg/s>  Fastest a servo moves to the first pose and back to rest (default 30)
  --simulator           Play to ht-servo's simulated adapter instead of hardware
  --list-ports          List serial ports and exit
  --verbose             Log the adapter's notes as it is brought up
  -h, --help            Show this help`

// As the editor opens the port: DTR low, and reporting off before every close.
const OPEN_OPTIONS = { baudRate: 115200, assertDtrOnOpen: false, farewell: REPORT_OFF }

function log(message: string): void {
  console.log(message)
}

function number(value: string | undefined, name: string, fallback: number): number {
  if (value == null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of 0 or more, not "${value}".`)
  return n
}

async function choosePort(link: Link, asked: string | undefined): Promise<string> {
  if (asked) return asked
  const ports = await link.list()
  const likely = ports.find((p) => p.likelyAdapter)
  if (likely) return likely.id
  const found = ports.length ? ` Ports found: ${ports.map((p) => p.id).join(', ')}.` : ' No serial ports were found.'
  throw new Error(`No port looks like a DPC-20; name one with --port.${found}`)
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      loop: { type: 'boolean', default: false },
      gap: { type: 'string' },
      'home-speed': { type: 'string' },
      simulator: { type: 'boolean', default: false },
      'list-ports': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    log(USAGE)
    return 0
  }
  if (values['list-ports']) {
    const ports = await new NodeSerialLink().list()
    for (const p of ports) log(`${p.label}${p.likelyAdapter ? '  <- likely adapter' : ''}`)
    if (ports.length === 0) log('No serial ports found.')
    return 0
  }
  const file = positionals[0]
  if (!file || positionals.length > 1) {
    console.error(USAGE)
    return 2
  }

  const gapMs = number(values.gap, '--gap', 0) * 1000
  const homeSpeed = number(values['home-speed'], '--home-speed', 30)
  if (homeSpeed === 0) throw new Error('--home-speed must be more than 0.')
  const show = parseShow(JSON.parse(await readFile(file, 'utf8')))
  log(`${show.name}: ${show.channels.length} channel${show.channels.length === 1 ? '' : 's'}, ${(show.source.durationMs / 1000).toFixed(1)} s`)

  const link: Link = values.simulator ? new FakeLink() : new NodeSerialLink()
  const portId = values.simulator ? FAKE_PORT_ID : await choosePort(link, values.port)
  await link.open(portId, OPEN_OPTIONS)
  log(`Opened ${portId}`)

  const bus = new Bus(link, portId, OPEN_OPTIONS, (kind, text) => {
    if (kind === 'error' || (values.verbose && kind === 'note')) log(text)
  })
  let closing = false
  // The adapter unplugged: the bus stops, and the player fails with it.
  link.onClose(() => {
    if (!bus.reopening && !closing) bus.dispose()
  })
  link.onError((error) => {
    if (!bus.reopening) log(`Port error: ${error.message}`)
  })

  const player = new Player(bus, show, { loop: values.loop, gapMs, homeSpeed, log })
  let signals = 0
  const onSignal = (name: string) => {
    if (++signals > 1) process.exit(130)
    log(`${name}: stopping (again to quit at once)`)
    void player.stop()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  try {
    const adapter = await bus.run(() => bus.detect())
    log(`Adapter ${adapter.text}`)
    // Stopped while the adapter was still being brought up.
    if (signals > 0) return 0
    await player.play()
    log('Stopped')
    return 0
  } finally {
    closing = true
    // The USB DPC-20 goes silent when its control lines change, so they
    // are lowered only on an adapter that had them raised, as the editor does.
    const lowerLines = bus.adapter != null && raiseDtrAfterDetect(bus.adapter)
    bus.dispose()
    if (lowerLines && link.isOpen) await link.setSignals({ dtr: false, rts: false }).catch(() => {})
    await link.close().catch(() => {})
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
)
