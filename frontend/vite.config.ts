import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Vite plugin to inject Wails runtime script
function wailsRuntime() {
  return {
    name: 'wails-runtime',
    transformIndexHtml(html: string) {
      return html.replace(
        '</body>',
        '<script src="/wailsjs/runtime/runtime.js"></script>\n</body>'
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wailsRuntime()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
