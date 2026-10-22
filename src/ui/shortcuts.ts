import { useEffect } from 'react'
import { useShow } from '../stores/show'
import { useTransport } from '../stores/transport'
import { snapStep } from '../show/timecode'

/**
 * Editor keys, as a video or audio editor has them. Ignored while typing
 * in a field, where Space and Delete belong to the text.
 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

export function useShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const show = useShow.getState()
      const transport = useTransport.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // File and history keys work everywhere, fields included.
      if (mod && key === 's') {
        e.preventDefault()
        void show.save(e.shiftKey)
        return
      }
      if (mod && key === 'o') {
        e.preventDefault()
        void show.open()
        return
      }
      if (typing(e.target)) return
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) show.redo()
        else show.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        show.redo()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        show.selectAllKeys()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        if (show.selection.channelId) show.duplicateChannel(show.selection.channelId)
        return
      }
      if (mod) return

      const { channelId, keyIds } = show.selection
      const channel = show.show.channels.find((c) => c.id === channelId)
      const step = snapStep(show.show.source.fps, show.show.source.bpm)

      switch (e.key) {
        case ' ':
          e.preventDefault()
          transport.toggle()
          break
        case 'Home':
          transport.seek(0)
          break
        case 'End':
          transport.seek(show.show.source.durationMs)
          break
        case 'Delete':
        case 'Backspace':
          show.deleteSelectedKeys()
          break
        case 'k':
        case 'K':
          if (channel) show.addKey(channel.id, transport.positionMs)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const dir = e.key === 'ArrowLeft' ? -1 : 1
          if (channel && keyIds.length) {
            const moves = channel.keys.filter((k) => keyIds.includes(k.id))
            show.edit((s) => ({
              ...s,
              channels: s.channels.map((c) =>
                c.id !== channel.id
                  ? c
                  : {
                      ...c,
                      keys: c.keys
                        .map((k) => (moves.some((m) => m.id === k.id) ? { ...k, t: Math.max(0, k.t + dir * step) } : k))
                        .sort((a, b) => a.t - b.t),
                    }
              ),
            }), `nudge-t:${keyIds.join(',')}`)
          } else {
            transport.seek(transport.positionMs + dir * step * (e.shiftKey ? 10 : 1))
          }
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!channel || keyIds.length === 0) break
          e.preventDefault()
          const dv = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1)
          show.edit((s) => ({
            ...s,
            channels: s.channels.map((c) =>
              c.id !== channel.id
                ? c
                : {
                    ...c,
                    keys: c.keys.map((k) =>
                      keyIds.includes(k.id) ? { ...k, v: Math.min(c.max, Math.max(c.min, k.v + dv)) } : k
                    ),
                  }
            ),
          }), `nudge-v:${keyIds.join(',')}`)
          break
        }
        case 'Escape':
          show.select({ keyIds: [] })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
