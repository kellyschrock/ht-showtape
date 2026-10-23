import { create } from 'zustand'

/**
 * Whether the monitor is docked in the inspector or popped out into its
 * own window, as Chrome does with its developer tools.
 *
 * The window is opened from this page and drawn into with a React portal,
 * so it shares this page's show, clock and simulation: nothing is copied
 * across or kept in step. Closing it docks the monitor again.
 */

/** Electron only allows a window by this name; see electron/main.ts. */
const FRAME_NAME = 'showtape-monitor'

interface MonitorState {
  /** The popped-out window, or null while docked. */
  popup: Window | null
  popOut(): void
  dock(): void
}

/** Gives the empty window this page's look: theme, stylesheets and a root to render into. */
function prepare(popup: Window): void {
  const doc = popup.document
  doc.title = 'Monitor — Showtape'
  for (const attr of Array.from(document.documentElement.attributes)) {
    doc.documentElement.setAttribute(attr.name, attr.value)
  }
  for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    doc.head.appendChild(doc.importNode(node, true))
  }
  doc.body.className = 'st-popout'
  const root = doc.createElement('div')
  root.id = 'monitor-root'
  doc.body.appendChild(root)
}

export const useMonitor = create<MonitorState>((set, get) => {
  // The editor going away takes its monitor window with it.
  window.addEventListener('pagehide', () => get().popup?.close())

  return {
    popup: null,

    popOut() {
      const open = get().popup
      if (open && !open.closed) {
        open.focus()
        return
      }
      // Sizes are for the browser; Electron sizes it from the last time it was open.
      const popup = window.open('', FRAME_NAME, 'popup,width=720,height=520')
      if (!popup) return
      prepare(popup)
      popup.addEventListener('pagehide', () => {
        if (get().popup === popup) set({ popup: null })
      })
      set({ popup })
    },

    dock() {
      const popup = get().popup
      set({ popup: null })
      popup?.close()
    },
  }
})
