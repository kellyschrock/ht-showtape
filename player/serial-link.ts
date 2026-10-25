/**
 * ht-servo's Link over a serial port, for a plain Node process.
 *
 * The desktop app reaches the port through Electron's main process and an
 * IPC bridge. The player has no windows and no renderer, so it owns the
 * port directly; everything above the Link (framing, the bus, detection)
 * is ht-servo's, unchanged.
 */

import { SerialPort } from 'serialport'
import { LinkEmitter } from '../ht-servo/src/transport/link'
import type { CloseOptions, Link, OpenOptions, PortInfo, Signals, Unsubscribe } from '../ht-servo/src/transport/link'

/** USB bridges the adapters are built on, as ht-servo's port list sorts them. */
const LIKELY_BRIDGES = [
  { vendorId: '10c4', productId: 'ea60' }, // Silicon Labs CP210x, seen on a DPC-CAN
  { vendorId: '0403', productId: '6001' }, // FTDI FT232
  { vendorId: '1a86', productId: '7523' }, // CH340
]

export class NodeSerialLink implements Link {
  // Nothing reads the kind; this is the desktop transport in all but name.
  readonly kind = 'electron' as const
  private emitter = new LinkEmitter()
  private port: SerialPort | null = null
  private farewell: Buffer | null = null
  portId: string | null = null

  get isOpen(): boolean {
    return this.port?.isOpen === true
  }

  async list(): Promise<PortInfo[]> {
    const ports = await SerialPort.list()
    return ports
      .map((p) => {
        const vendorId = (p.vendorId ?? '').toLowerCase()
        const productId = (p.productId ?? '').toLowerCase()
        const likelyAdapter = LIKELY_BRIDGES.some((b) => b.vendorId === vendorId && b.productId === productId)
        return { id: p.path, label: p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path, likelyAdapter }
      })
      .sort((a, b) => Number(b.likelyAdapter) - Number(a.likelyAdapter) || a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  open(portId: string, options: OpenOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: portId,
        baudRate: options.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        // Keeps DTR low as the port opens; raising it power-cycles the adapter.
        hupcl: options.assertDtrOnOpen === true,
        autoOpen: false,
      })
      port.open((error) => {
        if (error) return reject(error)
        this.port = port
        this.portId = portId
        this.farewell = options.farewell?.length ? Buffer.from(options.farewell) : null
        port.on('data', (chunk: Buffer) => this.emitter.emitData(new Uint8Array(chunk)))
        port.on('close', () => {
          if (this.port === port) this.port = null
          this.emitter.emitClose()
        })
        port.on('error', (err: Error) => this.emitter.emitError(err))
        resolve()
      })
    })
  }

  async close(options: CloseOptions = {}): Promise<void> {
    const port = this.port
    if (!port?.isOpen) return
    if (this.farewell && !options.skipFarewell) {
      const bytes = this.farewell
      try {
        await new Promise<void>((resolve, reject) => port.write(bytes, (e) => (e ? reject(e) : port.drain(() => resolve()))))
        await new Promise((resolve) => setTimeout(resolve, 50))
      } catch {
        // Closing the port is what matters.
      }
    }
    await new Promise<void>((resolve, reject) => port.close((e) => (e ? reject(e) : resolve())))
  }

  write(data: Uint8Array): Promise<void> {
    const port = this.port
    if (!port) return Promise.reject(new Error('The port is not open.'))
    return new Promise((resolve, reject) => port.write(Buffer.from(data), (e) => (e ? reject(e) : resolve())))
  }

  setSignals(signals: Signals): Promise<void> {
    const port = this.port
    if (!port) return Promise.reject(new Error('The port is not open.'))
    // An explicit pair, or set() raises whichever line was left out.
    const next = { dtr: signals.dtr ?? false, rts: signals.rts ?? false }
    return new Promise((resolve, reject) => port.set(next, (e) => (e ? reject(e) : resolve())))
  }

  flushInput(): Promise<void> {
    const port = this.port
    return port ? new Promise((resolve) => port.flush(() => resolve())) : Promise.resolve()
  }

  onData(handler: (chunk: Uint8Array) => void): Unsubscribe {
    return this.emitter.onData(handler)
  }

  onClose(handler: () => void): Unsubscribe {
    return this.emitter.onClose(handler)
  }

  onError(handler: (error: Error) => void): Unsubscribe {
    return this.emitter.onError(handler)
  }
}
