import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** Commit git courant (court), affiché dans les rapports de bug (cf.
 *  src/lib/bugReport.js::APP_VERSION) — chaîne vide hors dépôt git. */
function gitVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // En dev, le commit est celui du lancement du serveur : suffixé "(dev)".
    __APP_VERSION__: JSON.stringify(command === 'serve' ? `${gitVersion()} (dev)` : gitVersion()),
  },
}))
