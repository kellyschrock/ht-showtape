import { describe, expect, it } from 'vitest'
import { newChannel, newShow, parseShow, serializeShow, type Pose, type Show } from './model'
import { cueOfKey, holdPose, resolveShow, syncPoses } from './poses'
import { sampleChannel } from './sample'

function figure(): Show {
  const show = newShow()
  const elbow = { ...newChannel(0), id: 'elbow', name: 'Elbow', keys: [{ id: 'k1', t: 0, v: 10, ease: 'linear' as const }] }
  const head = { ...newChannel(1), id: 'head', name: ' Head ', rest: 5 }
  return { ...show, channels: [elbow, head] }
}

const armsOut: Pose = { id: 'p1', name: 'Arms out', values: { Elbow: 40 } }

describe('resolveShow', () => {
  it('puts a key from the pose on each channel it names, and leaves the others alone', () => {
    const show = { ...figure(), cues: [{ id: 'q1', t: 1000, poseId: 'p1', holdMs: 0, ease: 'smooth' as const }], poses: [armsOut] }
    const [elbow, head] = resolveShow(show).channels
    expect(elbow!.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 10],
      [1000, 40],
    ])
    expect(cueOfKey(elbow!.keys[1]!.id)).toBe('q1')
    expect(head).toBe(show.channels[1])
  })

  it('holds the pose for the hold time before moving on', () => {
    const show = { ...figure(), cues: [{ id: 'q1', t: 1000, poseId: 'p1', holdMs: 500, ease: 'smooth' as const }], poses: [armsOut] }
    show.channels[0]!.keys.push({ id: 'k2', t: 3000, v: 0, ease: 'linear' })
    const elbow = resolveShow(show).channels[0]!
    expect(sampleChannel(elbow, 1250)).toBe(40)
    expect(sampleChannel(elbow, 1500)).toBe(40)
    expect(sampleChannel(elbow, 2250)).toBeLessThan(40)
    expect(cueOfKey(elbow.keys[2]!.id)).toBe('q1')
  })

  it('sets aside hand-drawn keys inside a hold, on the channels the pose names', () => {
    const show = { ...figure(), cues: [{ id: 'q1', t: 1000, poseId: 'p1', holdMs: 1000, ease: 'smooth' as const }], poses: [armsOut] }
    show.channels[0]!.keys.push({ id: 'k2', t: 1500, v: -30, ease: 'linear' }, { id: 'k3', t: 2500, v: 0, ease: 'linear' })
    show.channels[1]!.keys.push({ id: 'h1', t: 1500, v: 3, ease: 'linear' })
    const [elbow, head] = resolveShow(show).channels
    expect(elbow!.keys.map((k) => k.id)).toEqual(['k1', 'cue:q1', 'cue:q1:hold', 'k3'])
    expect(sampleChannel(elbow!, 1500)).toBe(40)
    expect(head!.keys.map((k) => k.id)).toEqual(['h1'])
  })

  it('lets a cue win over a hand-drawn key at the same time', () => {
    const show = { ...figure(), cues: [{ id: 'q1', t: 0, poseId: 'p1', holdMs: 0, ease: 'smooth' as const }], poses: [armsOut] }
    expect(sampleChannel(resolveShow(show).channels[0]!, 0)).toBe(40)
  })

  it('matches a channel by its name without stray spaces', () => {
    const pose: Pose = { id: 'p2', name: 'Look', values: { Head: -20 } }
    const show = { ...figure(), cues: [{ id: 'q1', t: 0, poseId: 'p2', holdMs: 0, ease: 'smooth' as const }], poses: [pose] }
    expect(sampleChannel(resolveShow(show).channels[1]!, 0)).toBe(-20)
  })

  it('ignores a cue whose pose is missing, and returns the same show with no cues', () => {
    const plain = figure()
    expect(resolveShow(plain)).toBe(plain)
    const show = { ...plain, cues: [{ id: 'q1', t: 0, poseId: 'gone', holdMs: 0, ease: 'smooth' as const }] }
    expect(resolveShow(show).channels[0]!.keys).toHaveLength(1)
  })
})

describe('syncPoses', () => {
  const cue = { id: 'q1', t: 0, poseId: 'p1', holdMs: 0, ease: 'smooth' as const }

  it('takes the library version of each pose the cues use', () => {
    const show = { ...figure(), cues: [cue], poses: [armsOut] }
    const newer = { ...armsOut, values: { Elbow: 50 } }
    expect(syncPoses(show, [newer]).poses).toEqual([newer])
  })

  it('keeps its own copy of a pose the library lacks, drops unused ones, and is a no-op when current', () => {
    const show = { ...figure(), cues: [cue], poses: [armsOut, { id: 'p9', name: 'Old', values: {} }] }
    const synced = syncPoses(show, [])
    expect(synced.poses).toEqual([armsOut])
    expect(syncPoses(synced, [{ ...armsOut }])).toBe(synced)
  })
})

describe('holdPose', () => {
  it('holds each named channel at its pose value', () => {
    const held = holdPose(figure(), armsOut)
    expect(sampleChannel(held.channels[0]!, 9999)).toBe(40)
    expect(held.channels[1]!.keys).toEqual([])
  })
})

describe('cues in a show file', () => {
  it('round-trip, and bad ones are dropped', () => {
    const show = { ...figure(), cues: [{ id: 'q1', t: 250, poseId: 'p1', holdMs: 100, ease: 'step' as const }], poses: [armsOut] }
    const back = parseShow(JSON.parse(serializeShow(show)))
    expect(back.cues).toEqual(show.cues)
    expect(back.poses).toEqual([armsOut])
    const raw = JSON.parse(serializeShow(show))
    raw.cues.push({ t: 'soon' }, { poseId: 'p1' })
    raw.poses.push({ name: 'no id' }, { id: 'p3', values: { A: 'x', B: 2 } })
    const tidy = parseShow(raw)
    expect(tidy.cues).toHaveLength(1)
    expect(tidy.poses[1]).toEqual({ id: 'p3', name: 'Pose', values: { B: 2 } })
  })

  it('an older show has none', () => {
    const raw = JSON.parse(serializeShow(figure()))
    delete raw.cues
    delete raw.poses
    expect(parseShow(raw)).toMatchObject({ cues: [], poses: [] })
  })
})
