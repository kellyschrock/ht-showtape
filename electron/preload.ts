/**
 * The privileged surface: ht-servo's serial bridge, unchanged, as
 * window.htservo, plus show file open and save as window.showtape.
 *
 * src/types/showtape.d.ts mirrors the second object. Change them together.
 */

import { contextBridge, ipcRenderer } from 'electron'
import '../../ht-servo/electron/preload'

contextBridge.exposeInMainWorld('showtape', {
  files: {
    open: () => ipcRenderer.invoke('show:open'),
    save: (request: { text: string; path: string | null; name: string }) => ipcRenderer.invoke('show:save', request),
  },
})
