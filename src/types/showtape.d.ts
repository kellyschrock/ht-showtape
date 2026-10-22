/** Mirror of the showtape object electron/preload.ts exposes. */

export interface ShowtapeBridge {
  files: {
    open(): Promise<{ path: string; text: string } | null>
    save(request: { text: string; path: string | null; name: string }): Promise<{ path: string } | null>
    /** Save, Don't save, or Cancel, for a show with unsaved changes. */
    askSave(name: string): Promise<'save' | 'discard' | 'cancel'>
  }
  window: {
    /** Tells the main process whether closing the window would lose changes. */
    setDirty(dirty: boolean, name: string): void
    /** The user chose Save when closing; save, then call close() if it worked. Returns an unsubscribe. */
    onSaveAndClose(fn: () => void): () => void
    close(): void
  }
}

declare global {
  interface Window {
    showtape?: ShowtapeBridge
  }
}

export {}
