import { useConnection } from '@ht/stores/connection'
import { formatSeconds, formatTimecode } from '../show/timecode'
import { useShow } from '../stores/show'
import { useTransport } from '../stores/transport'

function Clock() {
  const t = useTransport((s) => s.positionMs)
  const fps = useShow((s) => s.show.source.fps)
  const durationMs = useShow((s) => s.show.source.durationMs)
  return (
    <div className="st-clock">
      <span className="st-clock__tc">{formatTimecode(t, fps)}</span>
      <span className="st-clock__sub">
        {formatSeconds(t)} / {formatSeconds(durationMs)}
      </span>
    </div>
  )
}

function OutputControl() {
  const ready = useConnection((s) => s.state === 'ready')
  const armed = useTransport((s) => s.armed)
  const arming = useTransport((s) => s.arming)
  const stats = useTransport((s) => s.stats)
  const error = useTransport((s) => s.outputError)
  const outputHz = useShow((s) => s.show.outputHz)

  return (
    <div className="st-output">
      {error ? (
        <span className="ht-tag ht-tag--bad" title={error}>
          {error}
        </span>
      ) : armed && stats ? (
        <span
          className={`ht-tag ${stats.achievedHz < outputHz * 0.8 ? 'ht-tag--warn' : 'ht-tag--ok'}`}
          title="Updates that reached the bus in the last second, against the show's output rate. Dropped: ticks skipped because the bus was still busy."
        >
          {stats.achievedHz} / {outputHz} Hz · {stats.dropped} dropped
        </span>
      ) : null}
      <button
        type="button"
        className={`ht-btn ${armed ? 'ht-btn--primary st-live' : 'ht-btn--ghost'}`}
        disabled={!armed && (!ready || arming)}
        title={ready ? 'Send the show to the servos while it plays or is scrubbed' : 'Connect an adapter first'}
        onClick={() => (armed ? useTransport.getState().disarm() : void useTransport.getState().arm())}
      >
        <span className="st-live__dot" />
        {arming ? 'Reading servos' : armed ? 'Servos live' : 'Servos off'}
      </button>
    </div>
  )
}

export function TransportBar() {
  const playing = useTransport((s) => s.playing)
  const loop = useTransport((s) => s.loop)
  const snap = useTransport((s) => s.snap)
  const zoom = useTransport((s) => s.zoom)
  const t = useTransport.getState()

  return (
    <div className="st-transport">
      <div className="st-transport__group">
        <button type="button" className="st-tbtn" title="To start (Home)" onClick={() => t.seek(0)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3h2v10H3zM13 3v10L6 8z" />
          </svg>
        </button>
        <button
          type="button"
          className={`st-tbtn st-tbtn--play${playing ? ' st-tbtn--on' : ''}`}
          title="Play or pause (Space)"
          onClick={() => t.toggle()}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 3h3v10H4zM9 3h3v10H9z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 2.5v11L13 8z" />
            </svg>
          )}
        </button>
        <button type="button" className="st-tbtn" title="Stop and return to start" onClick={() => t.stop()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4h8v8H4z" />
          </svg>
        </button>
        <button
          type="button"
          className={`st-tbtn${loop ? ' st-tbtn--on' : ''}`}
          title="Loop"
          aria-pressed={loop}
          onClick={() => t.setLoop(!loop)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 5h7V3l3 3-3 3V7H4a1 1 0 0 0-1 1v1H1V8a3 3 0 0 1 3-3zm8 6H5v2l-3-3 3-3v2h7a1 1 0 0 0 1-1V8h2v1a3 3 0 0 1-3 3z" />
          </svg>
        </button>
      </div>

      <Clock />

      <div className="st-transport__group">
        <button
          type="button"
          className={`ht-btn ht-btn--sm ${snap ? 'ht-btn--secondary' : 'ht-btn--ghost'}`}
          aria-pressed={snap}
          title="Snap keys to frames, or to beats when the show has a tempo. Hold Alt while dragging to override."
          onClick={() => t.setSnap(!snap)}
        >
          Snap
        </button>
        <label className="st-zoom" title="Zoom (Ctrl + wheel on the timeline)">
          <span className="ht-label">Zoom</span>
          <input
            type="range"
            className="ht-range"
            min={Math.log(10)}
            max={Math.log(1000)}
            step={0.01}
            value={Math.log(zoom)}
            onChange={(e) => t.setZoom(Math.exp(Number(e.target.value)))}
          />
        </label>
      </div>

      <div className="ht-spacer" />
      <OutputControl />
    </div>
  )
}
