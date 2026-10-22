import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
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
  mainWindow.webContents.on('did-start-loading', () => {
    // A reload starts a fresh show, which reports its own state.
    showDirty = false
    void links.closeAll()
  })
  mainWindow.webContents.on('render-process-gone', () => void links.closeAll())
  // Unsaved changes hold the window open until the user says what to do.
  mainWindow.on('close', (event) => {
    if (!showDirty || closing || !mainWindow) return
    event.preventDefault()
    void askSave(showName).then((choice) => {
      if (choice === 'save') mainWindow?.webContents.send('show:save-and-close')
      else if (choice === 'discard') closeWindow()
    })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// What the renderer last said about the open show, so closing can ask first.
let showDirty = false
let showName = ''
/** Set once the user has agreed to close, so the close handler lets it through. */
let closing = false

function closeWindow(): void {
  closing = true
  mainWindow?.close()
}

type SaveChoice = 'save' | 'discard' | 'cancel'

async function askSave(name: string): Promise<SaveChoice> {
  if (!mainWindow) return 'discard'
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `Save changes to “${name || 'Untitled show'}”?`,
    detail: "Your changes are lost if you don't save them.",
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  })
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
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

/**
 * A file chosen through zenity, Linux's stock GTK chooser tool. Electron's
 * own GTK dialog (42 to 45 at least) mishandles keyboard use: Enter or a
 * double-click on a file comes back as cancelled, so the open or save
 * silently does nothing. zenity's chooser behaves.
 *
 * Resolves to the path, null when cancelled, or undefined when zenity is
 * not there to ask, so the caller can fall back to Electron's dialog.
 */
function zenityFile(args: string[]): Promise<string | null | undefined> {
  if (process.platform !== 'linux') return Promise.resolve(undefined)
  const attach: string[] = []
  // Keeps the chooser above the editor. A window handle is an X11 id only off Wayland.
  if (mainWindow && process.env.XDG_SESSION_TYPE !== 'wayland') {
    attach.push('--modal', `--attach=${mainWindow.getNativeWindowHandle().readUInt32LE(0)}`)
  }
  return new Promise((resolve) => {
    const child = spawn('zenity', ['--file-selection', ...attach, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.on('error', () => resolve(undefined))
    child.on('close', (code) => {
      const file = out.replace(/\n$/, '')
      if (code === 0 && file) resolve(file)
      // 1 is cancel or close; anything else is zenity failing, so let Electron try.
      else resolve(code === 1 ? null : undefined)
    })
  })
}

const ZENITY_FILTER = '--file-filter=Showtape | *.showtape.json *.json'

/** One file dialog at a time: zenity does not stop clicks reaching the editor. */
let choosing = false

async function chooseFile(kind: 'open' | 'save', defaultPath: string): Promise<string | null> {
  if (!mainWindow || choosing) return null
  choosing = true
  try {
    const zenityArgs =
      kind === 'open'
        ? ['--title=Open show', `--filename=${defaultPath}${path.sep}`, ZENITY_FILTER]
        : [
            '--title=Save show',
            '--save',
            '--confirm-overwrite',
            `--filename=${defaultPath}`,
            ZENITY_FILTER,
          ]
    const picked = await zenityFile(zenityArgs)
    if (picked !== undefined) return picked

    if (kind === 'open') {
      const result = await dialog.showOpenDialog(mainWindow, {
        defaultPath,
        properties: ['openFile'],
        filters: SHOW_FILTERS,
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath, filters: SHOW_FILTERS })
    return result.canceled ? null : (result.filePath ?? null)
  } finally {
    choosing = false
  }
}

// Show files. The renderer never sees a path it did not get from a dialog.
ipcMain.handle('show:open', async () => {
  const file = await chooseFile('open', await lastShowDir())
  if (!file) return null
  const text = await readFile(file, 'utf8')
  await rememberShowDir(file)
  return { path: file, text }
})

ipcMain.handle(
  'show:save',
  async (_event, request: { text: string; path: string | null; name: string }) => {
    const file =
      request.path ??
      (await chooseFile(
        'save',
        path.join(await lastShowDir(), `${request.name || 'Untitled'}.showtape.json`),
      ))
    if (!file) return null
    await writeFile(file, request.text, 'utf8')
    await rememberShowDir(file)
    return { path: file }
  },
)

ipcMain.handle('show:ask-save', (_event, name: string) => askSave(String(name)))
ipcMain.on('show:dirty', (_event, dirty: boolean, name: string) => {
  showDirty = dirty === true
  showName = String(name)
})
ipcMain.on('show:close', () => closeWindow())

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
