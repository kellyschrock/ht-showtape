import { useConnection } from '@ht/stores/connection'
import { entryTitle, speedLabel, useServos, type ServoEntry } from '@ht/stores/servos'
import { useSelectedChannel, useShow } from '../stores/show'
import { Section } from './fields'

/**
 * The adapter and the servos behind it. The connection and the scan are
 * ht-servo's own stores, so this behaves exactly as the config tool does.
 */
export function ServosPanel() {
  return (
    <>
      <ConnectionSection />
      <ScanSection />
    </>
  )
}

function ConnectionSection() {
  const ports = useConnection((s) => s.ports)
  const selectedPort = useConnection((s) => s.selectedPort)
  const state = useConnection((s) => s.state)
  const openedPort = useConnection((s) => s.openedPort)
  const adapterVersion = useConnection((s) => s.adapterVersion)
  const lagging = useConnection((s) => s.adapterLagging)
  const error = useConnection((s) => s.error)
  const c = useConnection.getState()
  const busy = state === 'opening'
  const open = openedPort != null && !busy

  return (
    <Section title="Adapter">
      <div className="ht-row">
        <select
          className="ht-select st-grow"
          aria-label="Serial port"
          value={selectedPort ?? ''}
          disabled={open || busy}
          onChange={(e) => c.selectPort(e.target.value)}
        >
          {ports.length === 0 ? <option value="">{c.canRequestPort() ? 'Click Add port' : 'No ports found'}</option> : null}
          {ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {c.canRequestPort() ? (
          <button type="button" className="ht-btn ht-btn--ghost" disabled={open || busy} onClick={() => void c.requestPort()}>
            Add port
          </button>
        ) : (
          <button type="button" className="ht-btn ht-btn--ghost" disabled={open || busy} onClick={() => void c.refreshPorts()}>
            Refresh
          </button>
        )}
      </div>
      <div className="ht-row">
        {open ? (
          <button type="button" className="ht-btn ht-btn--ghost" onClick={() => void c.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="ht-btn ht-btn--primary" disabled={busy || !selectedPort} onClick={() => void c.connect()}>
            {busy ? 'Connecting' : 'Connect'}
          </button>
        )}
        <span className="ht-hint">{adapterVersion ? `Adapter ${adapterVersion}` : ''}</span>
      </div>
      {lagging ? (
        <div className="ht-banner ht-banner--warn">The adapter is answering late. Unplug it and reconnect before a show.</div>
      ) : null}
      <p className={`ht-hint${error ? ' ht-hint--error' : ''}`}>{error ?? ''}</p>
      {ports.length === 0 && !open ? (
        <p className="ht-hint">No hardware? Start the app with --simulator for a simulated adapter with three servos.</p>
      ) : null}
    </Section>
  )
}

function ScanSection() {
  const ready = useConnection((s) => s.state === 'ready')
  const entries = useServos((s) => s.entries)
  const scanning = useServos((s) => s.scanning)
  const status = useServos((s) => s.scanStatus)
  const error = useServos((s) => s.error)
  const channels = useShow((s) => s.show.channels)
  const busSpeed = useShow((s) => s.show.bus.speedCode)
  const selected = useSelectedChannel()

  function used(e: ServoEntry): string | undefined {
    return channels.find(
      (c) =>
        c.servo.servoId === e.servoId &&
        (e.protocol === 'dronecan' || c.servo.nodeId === e.nodeId) &&
        (c.servo.protocol === e.protocol || c.servo.protocol === 'default')
    )?.name
  }

  /** A servo found at another bitrate brings the show's bus with it. */
  function matchSpeed(e: ServoEntry): void {
    if (e.speedCode !== busSpeed) useShow.getState().edit((s) => ({ ...s, bus: { ...s.bus, speedCode: e.speedCode } }))
  }

  return (
    <Section
      title="Servos on the bus"
      actions={
        scanning ? (
          <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" onClick={() => useServos.getState().cancelScan()}>
            Stop
          </button>
        ) : (
          <button type="button" className="ht-btn ht-btn--sm ht-btn--secondary" disabled={!ready} onClick={() => void useServos.getState().scan()}>
            Scan
          </button>
        )
      }
    >
      <p className={`ht-hint${error ? ' ht-hint--error' : ''}`}>{error ?? status}</p>
      {entries.length === 0 && !scanning ? (
        <p className="ht-hint">{ready ? 'Scan to find servos and add them as channels.' : 'Connect an adapter to scan.'}</p>
      ) : null}
      <ul className="st-servolist">
        {entries.map((e) => {
          const owner = used(e)
          return (
            <li key={e.key} className="st-servolist__item">
              <div>
                <div className="st-servolist__title">{entryTitle(e)}</div>
                <div className="ht-hint">
                  {speedLabel(e.speedCode)}
                  {e.firmware ? ` · firmware ${e.firmware}` : ''}
                  {owner ? ` · on ${owner}` : ''}
                </div>
              </div>
              <div className="ht-row">
                <button
                  type="button"
                  className="ht-btn ht-btn--sm ht-btn--ghost"
                  onClick={() => {
                    matchSpeed(e)
                    useShow
                      .getState()
                      .addChannel({ protocol: e.protocol, servoId: e.servoId, nodeId: e.nodeId }, e.model || undefined)
                  }}
                >
                  Add channel
                </button>
                <button
                  type="button"
                  className="ht-btn ht-btn--sm ht-btn--ghost"
                  disabled={!selected}
                  title={selected ? `Point ${selected.name} at this servo` : 'Select a channel first'}
                  onClick={() => {
                    if (!selected) return
                    matchSpeed(e)
                    useShow.getState().updateChannel(selected.id, {
                      servo: { protocol: e.protocol, servoId: e.servoId, nodeId: e.nodeId },
                    })
                  }}
                >
                  Use for channel
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
