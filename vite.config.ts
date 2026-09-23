import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // three.js changes far less often than the app; keeping it in its own
        // chunk lets browsers keep it cached across deploys.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0', // Allow connections from any IP
    // Honor PORT so a second dev server (e.g. a tool-driven preview) can coexist.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/health': 'http://127.0.0.1:8000',
      '/sync-live': 'http://127.0.0.1:8000',
      '/render-v2': {
        target: 'http://127.0.0.1:8000',
        configure(proxy) {
          // The upload has finished before Blender renders. Forward a browser
          // disconnect during that wait so the server can stop its process.
          proxy.on('proxyReq', (proxyReq, _req, res) => {
            res.on('close', () => {
              if (!res.writableEnded) proxyReq.destroy();
            });
          });
        },
      },
    },
  },
})
