import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Parking-Surveyor/', // <-- IMPORTANT for GH Pages
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // use http://localhost:5173/overpass in code; Vite forwards to Overpass
      '/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/overpass/, '/api/interpreter'),
        secure: true,
      },
    },
  },
  build: {
    sourcemap: true, // helps debugging production builds
  },
});