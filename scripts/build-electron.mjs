/** Bundles the main process and the preload into dist-electron. */
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { entries, shared } from './electron-shared.mjs'

await rm('dist-electron', { recursive: true, force: true })
for (const entry of entries) await build({ ...shared, ...entry })
console.log('Built dist-electron/main.cjs and dist-electron/preload.cjs')
