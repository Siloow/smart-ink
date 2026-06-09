import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow connections from any IP
    port: 5173, // Default Vite port
    proxy: {
      '/health': 'http://127.0.0.1:8000',
      '/sync-live': 'http://127.0.0.1:8000',
      '/render-v2': 'http://127.0.0.1:8000',
    },
  },
})
