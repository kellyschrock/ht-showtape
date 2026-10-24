/**
 * Bundles the headless player into one file, dist-player/showtape-play.cjs.
 *
 * The show maths, the output and ht-servo's protocol and bus are all
 * inlined, so a Raspberry Pi needs only Node, that file and serialport
 * (which carries a native binding and so loads from node_modules).
 */
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('dist-player', { recursive: true, force: true })
await build({
  entryPoints: ['player/main.ts'],
  outfile: 'dist-player/showtape-play.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  external: ['serialport'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
})
