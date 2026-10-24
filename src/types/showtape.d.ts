/** Mirror of the showtape object electron/preload.ts exposes. */

export interface ShowtapeBridge {
  files: {
    open(): Promise<{ path: string; text: string } | null>
    save(request: { text: string; path: string | null; name: string }): Promise<{ path: string } | null>
    /** Save, Don't save, or Cancel, for a show with unsaved changes. */
    askSave(name: string): Promise<'save' | 'discard' | 'cancel'>
    /** The show the app was started with, once; null after that or if there was none. */
    takeLaunchFile(): Promise<{ path: string; text: string } | null>
  }
  window: {
    /** Tells the main process whether closing the window would lose changes. */
    setDirty(dirty: boolean, name: string): void
    /** The user chose Save when closing; save, then call close() if it worked. Returns an unsubscribe. */
    onSaveAndClose(fn: () => void): () => void
    close(): void
    /** A show opened from the file manager while the app was running. Returns an unsubscribe. */
    onOpenFile(fn: (picked: { path: string; text: string }) => void): () => void
  }
}

declare global {
  interface Window {
    showtape?: ShowtapeBridge
  }
}

export {}
