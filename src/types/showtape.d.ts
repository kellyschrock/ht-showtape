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
  poses: {
    /** The pose library file's text, or null when there is none yet. */
    load(): Promise<string | null>
    /** Replaces the pose library file. Written as it arrives, so a save just before closing still lands. */
    save(text: string): void
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
