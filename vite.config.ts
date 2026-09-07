import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow connections from any IP
    // Honor PORT so a second dev server (e.g. a tool-driven preview) can coexist.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/health': 'http://127.0.0.1:8000',
      '/sync-live': 'http://127.0.0.1:8000',
      '/render-v2': 'http://127.0.0.1:8000',
    },
  },
})
