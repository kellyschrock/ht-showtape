import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The servo layers (protocol, transport, bus, connection and servo stores,
// and the design system) come straight from the sibling ht-servo checkout
// rather than a copy, so a protocol fix there lands here on the next build.
const htServo = fileURLToPath(new URL('../ht-servo/src', import.meta.url))

// base './' so the build loads from file:// inside the desktop shell.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@ht': htServo },
    // ht-servo's sources resolve bare imports from its own node_modules
    // otherwise, and two copies of React or zustand break every hook.
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    sourcemap: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: ['.', htServo] },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
