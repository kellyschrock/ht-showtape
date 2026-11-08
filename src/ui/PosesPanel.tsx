import { useEffect } from 'react'
import type { Channel, Pose } from '../show/model'
import { poseName, resolveShow } from '../show/poses'
import { roundDegrees, sampleChannel } from '../show/sample'
import { usePoses } from '../stores/poses'
import { useShow } from '../stores/show'
import { useTransport } from '../stores/transport'
import { Field, NumberField, Section } from './fields'

/**
 * The pose library, and the pose being shaped.
 *
 * Holding a pose sends it to the figure in place of the timeline, so each
 * slider moves its servo, inside its limits and no faster than its max
 * speed. Leaving the panel, or pressing play, hands the figure back.
 *
 * A held servo can also be made limp and posed by hand, with its slider
 * following it.
 */

/** Each channel's value at the playhead, poses included, by the name a pose knows it by. */
function valuesAtPlayhead(channels?: readonly Channel[]): Record<string, number> {
  const show = resolveShow(useShow.getState().show)
  const t = useTransport.getState().positionMs
  const wanted = channels ? new Set(channels.map(poseName)) : null
  const values: Record<string, number> = {}
  for (const c of show.channels) {
    const name = poseName(c)
    if (name && (!wanted || wanted.has(name))) values[name] = roundDegrees(sampleChannel(c, t))
  }
  return values
}

export function PosesPanel() {
  const poses = usePoses((s) => s.poses)
  const editingId = usePoses((s) => s.editingId)
  const cues = useShow((s) => s.show.cues)
  const editing = poses.find((p) => p.id === editingId) ?? null

  // Leaving the panel hands the figure back to the timeline.
  useEffect(() => () => usePoses.getState().setPosing(false), [])

  function newPose() {
    usePoses.getState().create(`Pose ${poses.length + 1}`, valuesAtPlayhead())
  }

  return (
    <>
      <Section
        title="Pose library"
        actions={
          <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" title="Starts from every channel at the playhead" onClick={newPose}>
            New pose
          </button>
        }
      >
        {poses.length === 0 ? (
          <p className="ht-hint">
            A pose is a named position for some of the figure's servos, like “Arms out”. Make one, shape it on the figure,
            then place it on the timeline. Change it later and every place it is used changes too.
          </p>
        ) : (
          <ul className="st-poselist">
            {poses.map((p) => {
              const uses = cues.filter((c) => c.poseId === p.id).length
              const joints = Object.keys(p.values).length
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={p.id === editingId} onClick={() => usePoses.getState().edit(p.id === editingId ? null : p.id)}>
                    <span className="st-poselist__name">{p.name || 'Untitled pose'}</span>
                    <span className="st-poselist__meta">
                      {joints} servo{joints === 1 ? '' : 's'}
                      {uses ? ` · ${uses}× here` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="ht-hint">Kept in your library, not in the show, so every show can use them. Servos are matched by channel name.</p>
      </Section>
      {editing ? <PoseEditor pose={editing} uses={cues.filter((c) => c.poseId === editing.id).length} /> : null}
    </>
  )
}

function PoseEditor({ pose, uses }: { pose: Pose; uses: number }) {
  const channels = useShow((s) => s.show.channels)
  const posing = usePoses((s) => s.posing)
  const armed = useTransport((s) => s.armed)
  const playing = useTransport((s) => s.playing)
  const lib = usePoses.getState()

  const known = new Set(channels.map(poseName))
  const strays = Object.entries(pose.values).filter(([name]) => !known.has(name))

  function remove() {
    const ok = window.confirm(
      uses
        ? `Delete “${pose.name}”? It is placed ${uses} time${uses === 1 ? '' : 's'} in this show, and those go too. Other shows that use it keep their own copy.`
        : `Delete “${pose.name}” from the library? Shows that use it keep their own copy.`
    )
    if (!ok) return
    const show = useShow.getState()
    show.removeCues(show.show.cues.filter((c) => c.poseId === pose.id).map((c) => c.id))
    lib.remove(pose.id)
  }

  return (
    <Section
      title="Pose"
      actions={
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--ghost"
          title="Place this pose on the timeline at the playhead"
          onClick={() => useShow.getState().addCue(pose.id, useTransport.getState().positionMs)}
        >
          Place at playhead
        </button>
      }
    >
      <Field label="Name">
        <input className="ht-input" value={pose.name} onChange={(e) => lib.rename(pose.id, e.target.value)} />
      </Field>

      <div className="ht-row">
        <button
          type="button"
          className={`ht-btn ht-btn--sm ${posing ? 'st-posing' : 'ht-btn--secondary'}`}
          aria-pressed={posing}
          disabled={playing}
          onClick={() => lib.setPosing(!posing)}
        >
          {posing ? 'Holding this pose' : 'Hold this pose'}
        </button>
      </div>
      <p className="ht-hint">
        {playing
          ? 'Pause to hold a pose on the figure.'
          : posing
            ? armed
              ? 'The servos hold this pose. Each slider moves its servo, within its limits and max speed.'
              : 'The monitor holds this pose. Go live to move the servos with the sliders.'
            : 'The figure follows the timeline. Hold the pose to shape it on the figure, servo by servo.'}
      </p>

      {channels.map((c) => (
        <Joint key={c.id} pose={pose} channel={c} />
      ))}

      {strays.length ? (
        <>
          <p className="ht-hint">Not in this show:</p>
          {strays.map(([name, v]) => (
            <div key={name} className="st-joint st-joint--out">
              <span className="st-joint__name">
                {name} · {v}°
              </span>
              <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" title="Leave this servo out of the pose" onClick={() => lib.setValue(pose.id, name, null)}>
                Remove
              </button>
            </div>
          ))}
        </>
      ) : null}

      <div className="ht-row">
        <button
          type="button"
          className="ht-btn ht-btn--sm ht-btn--ghost"
          title="Set every servo in the pose to where the timeline has it at the playhead"
          onClick={() => lib.setValues(pose.id, valuesAtPlayhead(channels.filter((c) => pose.values[poseName(c)] != null)))}
        >
          Take from playhead
        </button>
        <button type="button" className="ht-btn ht-btn--sm ht-btn--ghost" onClick={() => lib.duplicate(pose.id)}>
          Duplicate
        </button>
        <span className="ht-spacer" />
        <button type="button" className="ht-btn ht-btn--sm ht-btn--danger" onClick={remove}>
          Delete
        </button>
      </div>
    </Section>
  )
}

/** One servo in the pose: whether the pose moves it, and to where. */
function Joint({ pose, channel }: { pose: Pose; channel: Channel }) {
  const name = poseName(channel)
  const v = pose.values[name]
  const included = v != null
  const posing = usePoses((s) => s.posing)
  const armed = useTransport((s) => s.armed)
  const live = posing && armed
  const limp = useTransport((s) => s.limp.includes(channel.id))
  const set = (next: number) => usePoses.getState().setValue(pose.id, name, roundDegrees(next))

  return (
    <div className={`st-joint${included ? '' : ' st-joint--out'}`}>
      <label className="st-joint__name" title={included ? 'This pose moves this servo' : 'This pose leaves this servo alone'}>
        <input
          type="checkbox"
          checked={included}
          disabled={!name}
          onChange={(e) => usePoses.getState().setValue(pose.id, name, e.target.checked ? (valuesAtPlayhead([channel])[name] ?? channel.rest) : null)}
        />
        <span className="st-joint__swatch" style={{ background: channel.color }} />
        {name || 'Unnamed channel'}
      </label>
      {included ? (
        <div className="st-joint__controls">
          <input
            className="ht-range"
            type="range"
            min={channel.min}
            max={channel.max}
            step={0.5}
            value={v}
            disabled={limp}
            onChange={(e) => set(Number(e.target.value))}
          />
          <NumberField value={v} min={channel.min} max={channel.max} step={0.5} suffix="°" onChange={set} />
          {live ? (
            <button
              type="button"
              className={`ht-btn ht-btn--sm ${limp ? 'ht-btn--secondary' : 'ht-btn--ghost'}`}
              aria-pressed={limp}
              title={limp ? 'Turn the motor back on, holding where it is now' : 'Release the motor to move this servo by hand. The pose follows it.'}
              onClick={() => void (limp ? useTransport.getState().engage(channel.id) : useTransport.getState().goLimp(channel.id))}
            >
              {limp ? 'Limp' : 'Go limp'}
            </button>
          ) : null}
        </div>
      ) : null}
      {limp ? <p className="ht-hint">Move it by hand. Click Limp to hold it there.</p> : null}
    </div>
  )
}
