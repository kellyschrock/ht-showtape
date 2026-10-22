/**
 * Development loop: a Vite dev server for the renderer, with Electron
 * pointed at it, and the two Electron sources rebuilt on change.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { context } from 'esbuild'
import electronPath from 'electron'
import { entries, shared } from './electron-shared.mjs'

const server = await createServer()
await server.listen()
const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('The dev server did not report a URL to load.')
server.printUrls()

const contexts = await Promise.all(entries.map((entry) => context({ ...shared, ...entry, logLevel: 'warning' })))
await Promise.all(contexts.map((ctx) => ctx.rebuild()))

// Arguments after `--` go to the app, e.g. npm run dev:electron -- --simulator
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})

const shutdown = async () => {
  await Promise.allSettled([...contexts.map((ctx) => ctx.dispose()), server.close()])
  process.exit(0)
}

child.on('close', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
