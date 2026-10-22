import { create } from 'zustand'
import {
  duplicateChannel,
  newChannel,
  newId,
  newShow,
  parseShow,
  serializeShow,
  sortKeys,
  type Channel,
  type Ease,
  type Keyframe,
  type Show,
} from '../show/model'
import { clamp, roundDegrees, sampleChannel } from '../show/sample'

/**
 * The open show, its undo history, the selection, and the file it came from.
 *
 * Every edit replaces the show with a new object, so undo is a stack of
 * old shows. A drag edits live many times a second; it calls begin() once
 * as it starts, which is the one snapshot undo goes back to.
 */

const HISTORY_LIMIT = 200
/** Typing into one field within this window is one undo step, not one per keystroke. */
const COALESCE_MS = 800

export interface Selection {
  channelId: string | null
  keyIds: string[]
}

interface ShowState {
  show: Show
  path: string | null
  dirty: boolean
  error: string | null
  past: Show[]
  future: Show[]
  selection: Selection

  /** Applies an edit as one undo step. `coalesce` merges repeats of the same field. */
  edit(fn: (show: Show) => Show, coalesce?: string): void
  /** Snapshot for undo at the start of a gesture; follow with live() calls. */
  begin(): void
  live(fn: (show: Show) => Show): void
  undo(): void
  redo(): void

  select(selection: Partial<Selection>): void
  addChannel(servo?: Partial<Channel['servo']>, name?: string): void
  /** Copies a channel, keys and all, to just below it, and selects the copy. */
  duplicateChannel(id: string): void
  removeChannel(id: string): void
  updateChannel(id: string, patch: Partial<Channel>, coalesce?: string): void
  addKey(channelId: string, t: number, v?: number): void
  updateKeys(channelId: string, ids: readonly string[], patch: Partial<Pick<Keyframe, 'v' | 't' | 'ease'>>): void
  deleteSelectedKeys(): void
  selectAllKeys(): void

  newShow(): void
  load(text: string, path: string | null): void
  save(saveAs?: boolean): Promise<void>
  /** Picks a show file and loads it. False if nothing was loaded. */
  open(): Promise<boolean>
  /**
   * Asks about unsaved changes before they would be thrown away: Save,
   * Don't save, or Cancel. True when it is fine to go ahead.
   */
  confirmDiscard(): Promise<boolean>
  clearError(): void
}

export function mapChannel(show: Show, id: string, fn: (c: Channel) => Channel): Show {
  return { ...show, channels: show.channels.map((c) => (c.id === id ? fn(c) : c)) }
}

let lastCoalesce: { key: string; at: number } | null = null

function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || 'Untitled'}.showtape.json`
  a.click()
  URL.revokeObjectURL(url)
}

function pickFileText(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      void file.text().then((text) => resolve({ name: file.name, text }))
    }
    input.click()
  })
}

export const useShow = create<ShowState>((set, get) => {
  function push(): void {
    const { show, past } = get()
    const next = [...past, show]
    set({ past: next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next, future: [] })
  }

  /** Drops a selection that points at channels or keys that no longer exist. */
  function tidy(show: Show, selection: Selection): Selection {
    const channel = show.channels.find((c) => c.id === selection.channelId)
    if (!channel) return { channelId: show.channels[0]?.id ?? null, keyIds: [] }
    const ids = new Set(channel.keys.map((k) => k.id))
    return { channelId: channel.id, keyIds: selection.keyIds.filter((id) => ids.has(id)) }
  }

  function replace(show: Show): void {
    set({ show, dirty: true, selection: tidy(show, get().selection) })
  }

  const initial = newShow()

  return {
    show: initial,
    path: null,
    dirty: false,
    error: null,
    past: [],
    future: [],
    selection: { channelId: initial.channels[0]!.id, keyIds: [] },

    edit(fn, coalesce) {
      const now = Date.now()
      const merge = coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < COALESCE_MS
      if (!merge) push()
      lastCoalesce = coalesce ? { key: coalesce, at: now } : null
      replace(fn(get().show))
    },

    begin() {
      lastCoalesce = null
      push()
    },

    live(fn) {
      replace(fn(get().show))
    },

    undo() {
      const { past, show, future } = get()
      const prev = past.at(-1)
      if (!prev) return
      lastCoalesce = null
      set({ past: past.slice(0, -1), future: [show, ...future], show: prev, dirty: true })
      set({ selection: tidy(prev, get().selection) })
    },

    redo() {
      const { past, show, future } = get()
      const next = future[0]
      if (!next) return
      lastCoalesce = null
      set({ past: [...past, show], future: future.slice(1), show: next, dirty: true })
      set({ selection: tidy(next, get().selection) })
    },

    select(selection) {
      set({ selection: { ...get().selection, ...selection } })
    },

    addChannel(servo, name) {
      const index = get().show.channels.length
      const channel = { ...newChannel(index, servo), ...(name ? { name } : {}) }
      get().edit((s) => ({ ...s, channels: [...s.channels, channel] }))
      set({ selection: { channelId: channel.id, keyIds: [] } })
    },

    duplicateChannel(id) {
      const show = get().show
      const copy = duplicateChannel(show, id)
      if (!copy) return
      const at = show.channels.findIndex((c) => c.id === id) + 1
      get().edit((s) => ({ ...s, channels: [...s.channels.slice(0, at), copy, ...s.channels.slice(at)] }))
      set({ selection: { channelId: copy.id, keyIds: [] } })
    },

    removeChannel(id) {
      get().edit((s) => ({ ...s, channels: s.channels.filter((c) => c.id !== id) }))
    },

    updateChannel(id, patch, coalesce) {
      get().edit(
        (s) =>
          mapChannel(s, id, (c) => {
            const next = { ...c, ...patch }
            // Keys and rest stay inside the limits, so the limits mean what they say.
            if (patch.min != null || patch.max != null) {
              if (next.min > next.max) [next.min, next.max] = [next.max, next.min]
              next.rest = clamp(next.rest, next.min, next.max)
              next.keys = next.keys.map((k) => ({ ...k, v: clamp(k.v, next.min, next.max) }))
            }
            return next
          }),
        coalesce ? `${id}:${coalesce}` : undefined
      )
    },

    addKey(channelId, t, v) {
      const channel = get().show.channels.find((c) => c.id === channelId)
      if (!channel) return
      const key: Keyframe = {
        id: newId('k'),
        t: Math.max(0, Math.round(t)),
        v: roundDegrees(clamp(v ?? sampleChannel(channel, t), channel.min, channel.max)),
        ease: 'smooth',
      }
      get().edit((s) => mapChannel(s, channelId, (c) => ({ ...c, keys: sortKeys([...c.keys, key]) })))
      set({ selection: { channelId, keyIds: [key.id] } })
    },

    updateKeys(channelId, ids, patch) {
      const wanted = new Set(ids)
      get().edit(
        (s) =>
          mapChannel(s, channelId, (c) => ({
            ...c,
            keys: sortKeys(
              c.keys.map((k) =>
                wanted.has(k.id)
                  ? {
                      ...k,
                      ...patch,
                      t: Math.max(0, patch.t ?? k.t),
                      v: roundDegrees(clamp(patch.v ?? k.v, c.min, c.max)),
                    }
                  : k
              )
            ),
          })),
        `keys:${ids.join(',')}:${Object.keys(patch).join(',')}`
      )
    },

    deleteSelectedKeys() {
      const { channelId, keyIds } = get().selection
      if (!channelId || keyIds.length === 0) return
      const gone = new Set(keyIds)
      get().edit((s) => mapChannel(s, channelId, (c) => ({ ...c, keys: c.keys.filter((k) => !gone.has(k.id)) })))
    },

    selectAllKeys() {
      const { channelId } = get().selection
      const channel = get().show.channels.find((c) => c.id === channelId)
      if (channel) set({ selection: { channelId: channel.id, keyIds: channel.keys.map((k) => k.id) } })
    },

    newShow() {
      const show = newShow()
      set({
        show,
        path: null,
        dirty: false,
        past: [],
        future: [],
        error: null,
        selection: { channelId: show.channels[0]!.id, keyIds: [] },
      })
    },

    load(text, path) {
      try {
        const show = parseShow(JSON.parse(text))
        set({
          show,
          path,
          dirty: false,
          past: [],
          future: [],
          error: null,
          selection: { channelId: show.channels[0]?.id ?? null, keyIds: [] },
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    async open() {
      const bridge = window.showtape
      const picked = bridge ? await bridge.files.open() : await pickFileText()
      if (!picked) return false
      get().load(picked.text, 'path' in picked ? picked.path : null)
      return get().error == null
    },

    async confirmDiscard() {
      const { dirty, show } = get()
      if (!dirty) return true
      const bridge = window.showtape
      if (!bridge) return window.confirm(`Discard unsaved changes to “${show.name}”?`)
      const choice = await bridge.files.askSave(show.name)
      if (choice === 'cancel') return false
      if (choice === 'discard') return true
      await get().save()
      // Cancelling the save dialog, or a failed write, leaves the show dirty.
      return !get().dirty
    },

    async save(saveAs = false) {
      const { show, path } = get()
      const text = serializeShow(show)
      const bridge = window.showtape
      if (!bridge) {
        downloadText(text, show.name)
        set({ dirty: false })
        return
      }
      try {
        const result = await bridge.files.save({ text, path: saveAs ? null : path, name: show.name })
        if (result) set({ path: result.path, dirty: false })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    clearError() {
      set({ error: null })
    },
  }
})

export function useSelectedChannel(): Channel | null {
  return useShow((s) => s.show.channels.find((c) => c.id === s.selection.channelId) ?? null)
}

export const EASES: ReadonlyArray<{ id: Ease; label: string }> = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'linear', label: 'Linear' },
  { id: 'step', label: 'Hold' },
]
