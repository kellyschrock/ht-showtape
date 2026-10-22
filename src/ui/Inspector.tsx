import { PROTOCOLS, SPEEDS, protocolLabel, type Protocol } from '@ht/protocol'
import { SOURCES, type Channel, type ChannelProtocol, type FrameRate } from '../show/model'
import { formatSeconds, parseSeconds } from '../show/timecode'
import { EASES, useSelectedChannel, useShow } from '../stores/show'
import { useTransport } from '../stores/transport'
import { Field, NumberField, Section } from './fields'
import { ServosPanel } from './ServosPanel'

export type InspectorTab = 'selection' | 'show' | 'servos'

const TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: 'selection', label: 'Channel' },
  { id: 'show', label: 'Show' },
  { id: 'servos', label: 'Servos' },
]

export function Inspector({ tab, onTab }: { tab: InspectorTab; onTab(tab: InspectorTab): void }) {
  const error = useShow((s) => s.error)
  return (
    <aside className="st-inspector">
      <nav className="st-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`st-tab${tab === t.id ? ' st-tab--on' : ''}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="st-inspector__body">
        {error ? (
          <div className="ht-banner ht-banner--bad">
            <span>{error}</span>
            <span className="ht-spacer" />
            <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" onClick={() => useShow.getState().clearError()}>
              Dismiss
            </button>
          </div>
        ) : null}
        {tab === 'selection' ? <SelectionPanel /> : tab === 'show' ? <ShowPanel /> : <ServosPanel />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Channel and keys
// ---------------------------------------------------------------------------

function SelectionPanel() {
  const channel = useSelectedChannel()
  if (!channel) return <p className="ht-hint">Select a channel on the timeline.</p>
  return (
    <>
      <KeysSection channel={channel} />
      <ChannelSection channel={channel} />
    </>
  )
}

function KeysSection({ channel }: { channel: Channel }) {
  const keyIds = useShow((s) => s.selection.keyIds)
  const updateKeys = useShow((s) => s.updateKeys)
  const keys = channel.keys.filter((k) => keyIds.includes(k.id))
  const one = keys.length === 1 ? keys[0]! : null

  return (
    <Section
      title={keys.length > 1 ? `${keys.length} keys` : 'Key'}
      actions={
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--ghost"
          title="K"
          onClick={() => useShow.getState().addKey(channel.id, useTransport.getState().positionMs)}
        >
          Add at playhead
        </button>
      }
    >
      {keys.length === 0 ? (
        <p className="ht-hint">
          No key selected. {channel.keys.length} key{channel.keys.length === 1 ? '' : 's'} on this channel.
        </p>
      ) : (
        <>
          {one ? (
            <>
              <Field label="Time">
                <TimeInput ms={one.t} onChange={(t) => updateKeys(channel.id, [one.id], { t })} />
              </Field>
              <Field label="Position">
                <NumberField
                  value={one.v}
                  min={channel.min}
                  max={channel.max}
                  step={0.5}
                  suffix="°"
                  onChange={(v) => updateKeys(channel.id, [one.id], { v })}
                />
              </Field>
            </>
          ) : null}
          <Field label="Into next" hint="How the curve leaves this key toward the next one">
            <select
              className="ht-select"
              value={keys.every((k) => k.ease === keys[0]!.ease) ? keys[0]!.ease : ''}
              onChange={(e) => updateKeys(channel.id, keyIds, { ease: e.target.value as Channel['keys'][number]['ease'] })}
            >
              {keys.some((k) => k.ease !== keys[0]!.ease) ? <option value="">Mixed</option> : null}
              {EASES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="ht-row">
            <button type="button" className="ht-btn ht-btn--sm ht-btn--danger" onClick={() => useShow.getState().deleteSelectedKeys()}>
              Delete {keys.length > 1 ? `${keys.length} keys` : 'key'}
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

function TimeInput({ ms, onChange }: { ms: number; onChange(ms: number): void }) {
  return (
    <input
      key={ms}
      className="ht-input st-time"
      defaultValue={formatSeconds(ms)}
      title="M:SS.mmm or seconds"
      onBlur={(e) => {
        const t = parseSeconds(e.target.value)
        if (t == null) e.target.value = formatSeconds(ms)
        else if (t !== ms) onChange(t)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function ChannelSection({ channel }: { channel: Channel }) {
  const busProtocol = useShow((s) => s.show.bus.protocol)
  const update = useShow((s) => s.updateChannel)
  const set = (patch: Partial<Channel>, field: string) => update(channel.id, patch, field)
  const protocol = channel.servo.protocol === 'default' ? busProtocol : channel.servo.protocol

  return (
    <>
      <Section title="Channel">
        <Field label="Name">
          <input className="ht-input st-wide" value={channel.name} onChange={(e) => set({ name: e.target.value }, 'name')} />
        </Field>
        <Field label="Colour">
          <input type="color" className="st-color" value={channel.color} onChange={(e) => set({ color: e.target.value }, 'color')} />
        </Field>
      </Section>

      <Section title="Servo">
        <Field label="Protocol" hint="Each channel can use its own protocol, or follow the show's default on the Show tab">
          <select
            className="ht-select"
            value={channel.servo.protocol}
            onChange={(e) => set({ servo: { ...channel.servo, protocol: e.target.value as ChannelProtocol } }, 'protocol')}
          >
            <option value="default">Show default ({protocolLabel(busProtocol)})</option>
            {PROTOCOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Servo ID">
          <NumberField
            value={channel.servo.servoId}
            min={0}
            max={protocol === 'dronecan' ? 127 : 255}
            onChange={(v) => set({ servo: { ...channel.servo, servoId: Math.round(v) } }, 'servoId')}
          />
        </Field>
        <Field label="Node ID" hint={protocol === 'dronecan' ? 'DroneCAN addresses by servo ID only' : 'The CAN identifier the servo listens on'}>
          <NumberField
            value={channel.servo.nodeId}
            min={0}
            max={protocol === 'can20b' ? 0x1fffffff : 0x7ff}
            disabled={protocol === 'dronecan'}
            onChange={(v) => set({ servo: { ...channel.servo, nodeId: Math.round(v) } }, 'nodeId')}
          />
        </Field>
      </Section>

      <Section title="Limits">
        <Field label="Minimum">
          <NumberField value={channel.min} min={-180} max={180} suffix="°" onChange={(v) => set({ min: v }, 'min')} />
        </Field>
        <Field label="Maximum">
          <NumberField value={channel.max} min={-180} max={180} suffix="°" onChange={(v) => set({ max: v }, 'max')} />
        </Field>
        <Field label="Rest" hint="Where the servo sits when the channel has no keys">
          <NumberField value={channel.rest} min={channel.min} max={channel.max} suffix="°" onChange={(v) => set({ rest: v }, 'rest')} />
        </Field>
        <Field label="Max speed" hint="The output never moves faster than this, whatever the keys say. 0 is unlimited.">
          <NumberField value={channel.maxSpeed} min={0} max={2000} step={10} suffix="°/s" onChange={(v) => set({ maxSpeed: v }, 'maxSpeed')} />
        </Field>
        <Field label="Trim" hint="Added at the servo, after the limits, to centre a mechanism without moving every key">
          <NumberField value={channel.trim} min={-90} max={90} step={0.5} suffix="°" onChange={(v) => set({ trim: v }, 'trim')} />
        </Field>
        <Field label="Invert">
          <input type="checkbox" checked={channel.invert} onChange={(e) => set({ invert: e.target.checked }, 'invert')} />
        </Field>
      </Section>

      <div className="ht-row">
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--secondary"
          title="Ctrl+D. The copy goes on the next free servo ID."
          onClick={() => useShow.getState().duplicateChannel(channel.id)}
        >
          Duplicate channel
        </button>
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--danger"
          onClick={() => useShow.getState().removeChannel(channel.id)}
        >
          Delete channel
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

function ShowPanel() {
  const show = useShow((s) => s.show)
  const edit = useShow((s) => s.edit)
  const armed = useTransport((s) => s.armed)
  const source = SOURCES.find((s) => s.kind === show.source.kind)!

  return (
    <>
      <Section title="Source">
        <p className="ht-hint">{source.hint}</p>
        <Field label="Length">
          <TimeInput
            ms={show.source.durationMs}
            onChange={(t) => edit((s) => ({ ...s, source: { ...s.source, durationMs: Math.max(1000, t) } }))}
          />
        </Field>
        <Field label="Frame rate" hint="For the timecode readout, and snapping when there is no tempo">
          <select
            className="ht-select"
            value={show.source.fps}
            onChange={(e) => edit((s) => ({ ...s, source: { ...s.source, fps: Number(e.target.value) as FrameRate } }))}
          >
            {[24, 25, 30].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tempo" hint="Optional. With a tempo the ruler counts bars and beats and keys snap to sixteenths.">
          <span className="ht-row">
            <input
              type="checkbox"
              checked={show.source.bpm != null}
              onChange={(e) => edit((s) => ({ ...s, source: { ...s.source, bpm: e.target.checked ? 120 : null } }))}
            />
            <NumberField
              value={show.source.bpm ?? 120}
              min={20}
              max={300}
              disabled={show.source.bpm == null}
              suffix="BPM"
              onChange={(v) => edit((s) => ({ ...s, source: { ...s.source, bpm: v } }), 'bpm')}
            />
          </span>
        </Field>
      </Section>

      <Section title="Bus">
        <Field label="Default protocol" hint="Used by every channel left on Show default">
          <select
            className="ht-select"
            value={show.bus.protocol}
            onChange={(e) => edit((s) => ({ ...s, bus: { ...s.bus, protocol: e.target.value as Protocol } }))}
          >
            {PROTOCOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bitrate" hint="One adapter runs one bitrate, so every servo in a show shares it">
          <select
            className="ht-select"
            value={show.bus.speedCode}
            onChange={(e) => edit((s) => ({ ...s, bus: { ...s.bus, speedCode: Number(e.target.value) } }))}
          >
            {SPEEDS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.kbps} kbps
              </option>
            ))}
          </select>
        </Field>
        <Field label="Output rate" hint="How often positions are sent while live. Takes effect the next time servos go live.">
          <NumberField value={show.outputHz} min={1} max={200} suffix="Hz" onChange={(v) => edit((s) => ({ ...s, outputHz: Math.round(v) }), 'hz')} />
        </Field>
        {armed ? <p className="ht-hint">Output rate changes apply the next time servos go live.</p> : null}
      </Section>
    </>
  )
}
