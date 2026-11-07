import { sortKeys, type Channel, type Cue, type Keyframe, type Pose, type Show } from './model'

/**
 * Poses on the timeline, turned into keys.
 *
 * A cue puts a key on each channel its pose names, and a second one where
 * its hold ends. Those keys are worked out from the pose every time rather
 * than stored, which is what makes a change to a pose reach every cue that
 * uses it. Everything that draws or plays a show works on the resolved
 * show, so a pose key is drawn, sent and speed-limited like any other.
 */

const CUE_KEY = 'cue:'

/** A key's id when a cue put it there. */
export function cueKeyId(cueId: string, hold = false): string {
  return `${CUE_KEY}${cueId}${hold ? ':hold' : ''}`
}

/** The cue a key came from, or null for a key drawn by hand. */
export function cueOfKey(keyId: string): string | null {
  if (!keyId.startsWith(CUE_KEY)) return null
  return keyId.slice(CUE_KEY.length).replace(/:hold$/, '')
}

/** How a pose names a channel: its name, without stray spaces. */
export function poseName(channel: Channel): string {
  return channel.name.trim()
}

export function poseValue(pose: Pose, channel: Channel): number | undefined {
  return pose.values[poseName(channel)]
}

/** The keys one cue puts on one channel; none if the pose leaves the channel out. */
export function cueKeys(cue: Cue, pose: Pose, channel: Channel): Keyframe[] {
  const v = poseValue(pose, channel)
  if (v == null) return []
  if (cue.holdMs <= 0) return [{ id: cueKeyId(cue.id), t: cue.t, v, ease: cue.ease }]
  return [
    { id: cueKeyId(cue.id), t: cue.t, v, ease: 'linear' },
    { id: cueKeyId(cue.id, true), t: cue.t + cue.holdMs, v, ease: cue.ease },
  ]
}

const resolved = new WeakMap<Show, Show>()

/**
 * The show with its cues turned into keys on its channels. A hand-drawn
 * key at a cue's time or inside its hold gives way to the cue on every
 * channel the pose names, since a hold is a promise the figure stays put.
 * Those keys stay in the show, to come back if the cue moves. Cached per
 * show object, so calling it every frame costs nothing until it changes.
 */
export function resolveShow(show: Show): Show {
  const cached = resolved.get(show)
  if (cached) return cached
  const poses = new Map(show.poses.map((p) => [p.id, p]))
  const placed = show.cues.flatMap((cue) => {
    const pose = poses.get(cue.poseId)
    return pose ? [{ cue, pose }] : []
  })
  const out =
    placed.length === 0
      ? show
      : {
          ...show,
          channels: show.channels.map((channel) => {
            const here = placed.filter(({ pose }) => poseValue(pose, channel) != null)
            if (here.length === 0) return channel
            const free = channel.keys.filter((k) => !here.some(({ cue }) => k.t >= cue.t && k.t <= cue.t + cue.holdMs))
            const extra = here.flatMap(({ cue, pose }) => cueKeys(cue, pose, channel))
            return { ...channel, keys: sortKeys([...free, ...extra]) }
          }),
        }
  resolved.set(show, out)
  return out
}

/**
 * The show with its copies of the poses its cues use brought up to date
 * from the library. A pose the library lacks keeps the show's own copy;
 * a pose no cue uses any more is dropped. The same show comes back when
 * nothing changed, so callers can tell.
 */
export function syncPoses(show: Show, library: readonly Pose[]): Show {
  const used = [...new Set(show.cues.map((c) => c.poseId))]
  const poses = used.flatMap((id) => {
    const pose = library.find((p) => p.id === id) ?? show.poses.find((p) => p.id === id)
    return pose ? [pose] : []
  })
  if (poses.length === show.poses.length && poses.every((p, i) => samePose(p, show.poses[i]!))) return show
  return { ...show, poses }
}

export function samePose(a: Pose, b: Pose): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.name !== b.name) return false
  const ak = Object.keys(a.values)
  return ak.length === Object.keys(b.values).length && ak.every((k) => a.values[k] === b.values[k])
}

/**
 * The show standing still in a pose: every channel the pose names holds its
 * value, and the rest follow the show as usual. This is what the servos are
 * sent while a pose is being shaped on the figure.
 */
export function holdPose(show: Show, pose: Pose): Show {
  return {
    ...show,
    channels: show.channels.map((channel) => {
      const v = poseValue(pose, channel)
      return v == null ? channel : { ...channel, keys: [{ id: 'posing', t: 0, v, ease: 'step' }] }
    }),
  }
}
