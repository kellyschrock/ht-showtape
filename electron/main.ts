import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

// The folder the last show was opened from or saved to, so the dialogs
// start there next time, across restarts. Without it, they start wherever
// the platform likes, which on Linux is often ~/Downloads.
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')

async function lastShowDir(): Promise<string> {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as { showDir?: unknown }
    if (typeof settings.showDir === 'string') return settings.showDir
  } catch {
    // No settings yet, or unreadable: fall back below.
  }
  return app.getPath('documents')
}

async function rememberShowDir(file: string): Promise<void> {
  try {
    await mkdir(path.dirname(SETTINGS_FILE), { recursive: true })
    await writeFile(
      SETTINGS_FILE,
      JSON.stringify({ showDir: path.dirname(file) }, null, 2) + '\n',
      'utf8',
    )
  } catch (error) {
    // Only a convenience; a failure here must not fail the open or save.
    console.error(`Could not remember the show folder in ${SETTINGS_FILE}:`, error)
  }
}

// Show files. The renderer never sees a path it did not get from a dialog.
ipcMain.handle('show:open', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: await lastShowDir(),
    properties: ['openFile'],
    filters: SHOW_FILTERS,
  })
  const file = result.filePaths[0]
  if (result.canceled || !file) return null
  const text = await readFile(file, 'utf8')
  await rememberShowDir(file)
  return { path: file, text }
})

ipcMain.handle('show:save', async (_event, request: { text: string; path: string | null; name: string }) => {
  if (!mainWindow) return null
  let file = request.path
  if (!file) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(await lastShowDir(), `${request.name || 'Untitled'}.showtape.json`),
      filters: SHOW_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    file = result.filePath
  }
  await writeFile(file, request.text, 'utf8')
  await rememberShowDir(file)
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
