import { create } from 'zustand'
import { newId, parsePoses, type Pose } from '../show/model'
import { samePose } from '../show/poses'

/**
 * The pose library: every pose made, kept outside any show so all shows
 * for a figure can use them.
 *
 * In the app it is a file in the user's settings folder; in a browser,
 * local storage. A show opened with poses the library lacks adds them, so
 * a show passed from one person to another brings its poses along.
 *
 * Also which pose is being shaped, and whether the figure is following it.
 */

const LIBRARY_FORMAT = 'hitec-showtape-poses'
const STORAGE_KEY = 'showtape.poses'
const SAVE_DELAY_MS = 300

interface PosesState {
  poses: Pose[]
  /** The library has been read; nothing is written before then. */
  loaded: boolean
  /** The pose open in the Poses panel. */
  editingId: string | null
  /** The figure holds the pose being edited instead of following the timeline. */
  posing: boolean

  load(): Promise<void>
  /** Adds poses the library lacks, from a show being opened. Ones it has are left as they are. */
  adopt(poses: readonly Pose[]): void
  create(name: string, values: Record<string, number>): Pose
  rename(id: string, name: string): void
  /** Sets a channel's value in a pose, or leaves the channel out with null. */
  setValue(id: string, channelName: string, v: number | null): void
  setValues(id: string, values: Record<string, number>): void
  duplicate(id: string): Pose | null
  remove(id: string): void
  edit(id: string | null): void
  setPosing(posing: boolean): void
}

function readLibrary(text: string | null): Pose[] {
  if (!text) return []
  try {
    const o = JSON.parse(text) as { format?: unknown; poses?: unknown }
    return o.format === LIBRARY_FORMAT ? parsePoses(o.poses) : []
  } catch {
    return []
  }
}

function writeLibrary(poses: readonly Pose[]): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, poses }, null, 2) + '\n'
}

async function loadText(): Promise<string | null> {
  const bridge = window.showtape
  if (bridge) return bridge.poses.load()
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function saveText(text: string): void {
  const bridge = window.showtape
  if (bridge) return bridge.poses.save(text)
  try {
    localStorage.setItem(STORAGE_KEY, text)
  } catch {
    // Storage blocked: the library lasts as long as the page.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const usePoses = create<PosesState>((set, get) => {
  function flush(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (get().loaded) saveText(writeLibrary(get().poses))
  }

  // Dragging a slider changes a pose many times a second; write once it settles.
  function change(poses: Pose[]): void {
    set({ poses })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, SAVE_DELAY_MS)
  }

  function mapPose(id: string, fn: (p: Pose) => Pose): void {
    change(get().poses.map((p) => (p.id === id ? fn(p) : p)))
  }

  window.addEventListener('pagehide', flush)

  return {
    poses: [],
    loaded: false,
    editingId: null,
    posing: false,

    async load() {
      const saved = readLibrary(await loadText())
      // Poses adopted from a show opened before the library was read are kept too.
      const early = get().poses.filter((p) => !saved.some((s) => s.id === p.id))
      set({ poses: [...saved, ...early], loaded: true })
      if (early.length) flush()
    },

    adopt(poses) {
      const have = get().poses
      const fresh = poses.filter((p) => !have.some((h) => h.id === p.id))
      if (fresh.length) change([...have, ...fresh])
    },

    create(name, values) {
      const pose: Pose = { id: newId('p'), name, values }
      change([...get().poses, pose])
      set({ editingId: pose.id })
      return pose
    },

    rename(id, name) {
      mapPose(id, (p) => ({ ...p, name }))
    },

    setValue(id, channelName, v) {
      mapPose(id, (p) => {
        const values = { ...p.values }
        if (v == null) delete values[channelName]
        else values[channelName] = v
        return { ...p, values }
      })
    },

    setValues(id, values) {
      mapPose(id, (p) => {
        const next = { ...p, values: { ...p.values, ...values } }
        return samePose(next, p) ? p : next
      })
    },

    duplicate(id) {
      const source = get().poses.find((p) => p.id === id)
      return source ? get().create(`${source.name} copy`, { ...source.values }) : null
    },

    remove(id) {
      change(get().poses.filter((p) => p.id !== id))
      if (get().editingId === id) set({ editingId: null, posing: false })
    },

    edit(id) {
      set({ editingId: id, posing: id != null && get().posing })
    },

    setPosing(posing) {
      set({ posing: posing && get().editingId != null })
    },
  }
})

/** The pose the figure is holding while one is being shaped, or null while it follows the timeline. */
export function heldPose(): Pose | null {
  const { posing, editingId, poses } = usePoses.getState()
  return posing ? (poses.find((p) => p.id === editingId) ?? null) : null
}
