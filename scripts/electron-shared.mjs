/**
 * esbuild settings for the main process and the preload, shared by the
 * build and the dev loop. Both pull ht-servo's serial host and preload in
 * from the sibling checkout, so the serial bridge is the same code in both
 * apps.
 */
export const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  // Electron is supplied by the runtime. serialport and koffi carry native
  // bindings, so they load from this app's node_modules at run time.
  external: ['electron', 'serialport', 'koffi'],
}

export const entries = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
]
