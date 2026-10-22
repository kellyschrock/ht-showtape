/** Mirror of the showtape object electron/preload.ts exposes. */

export interface ShowtapeBridge {
  files: {
    open(): Promise<{ path: string; text: string } | null>
    save(request: { text: string; path: string | null; name: string }): Promise<{ path: string } | null>
  }
}

declare global {
  interface Window {
    showtape?: ShowtapeBridge
  }
}

export {}
