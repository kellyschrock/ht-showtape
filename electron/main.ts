import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SerialLinkHost } from '../../ht-servo/electron/serial-link'

// Bundled to CommonJS, so __dirname is the real one.
const dirname = __dirname

const DEV_SERVER = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
const links = new SerialLinkHost()

const SHOW_FILTERS = [{ name: 'Showtape', extensions: ['showtape.json', 'json'] }]

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    // Paint before showing, on the editor's dark ground, so the window does
    // not flash white.
    show: false,
    backgroundColor: '#131417',
    title: 'Showtape',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  links.attach(mainWindow)

  if (DEV_SERVER) {
    void mainWindow.loadURL(DEV_SERVER)
  } else {
    void mainWindow.loadFile(path.join(dirname, '..', 'dist-web', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // A reload leaves the renderer with port ids it no longer knows about.
  mainWindow.webContents.on('did-start-loading', () => void links.closeAll())
  mainWindow.webContents.on('render-process-gone', () => void links.closeAll())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// The channels ht-servo's preload calls. Its bridge is reused unchanged, so
// these must keep its names.
ipcMain.handle('app:version', () => app.getVersion())

const flags = {
  simulator: app.commandLine.hasSwitch('simulator') || process.env.HTSERVO_SIMULATOR === '1',
}
ipcMain.on('app:flags', (event) => {
  event.returnValue = flags
})

ipcMain.handle('link:list', () => links.list())
ipcMain.handle('link:open', (_event, request) => links.open(request))
ipcMain.handle('link:close', (_event, id: number, skipFarewell: boolean) => links.close(id, skipFarewell === true))
ipcMain.handle('link:write', (_event, id: number, bytes: Uint8Array) => links.write(id, new Uint8Array(bytes)))
ipcMain.handle('link:setSignals', (_event, id: number, signals) => links.setSignals(id, signals))
ipcMain.handle('link:flushInput', (_event, id: number) => links.flushInput(id))

// Show files. The renderer never sees a path it did not get from a dialog.
ipcMain.handle('show:open', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: SHOW_FILTERS })
  const file = result.filePaths[0]
  if (result.canceled || !file) return null
  return { path: file, text: await readFile(file, 'utf8') }
})

ipcMain.handle('show:save', async (_event, request: { text: string; path: string | null; name: string }) => {
  if (!mainWindow) return null
  let file = request.path
  if (!file) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${request.name || 'Untitled'}.showtape.json`,
      filters: SHOW_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    file = result.filePath
  }
  await writeFile(file, request.text, 'utf8')
  return { path: file }
})

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void links.closeAll().then(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})
