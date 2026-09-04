import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes to the server's `public/` folder so the Express server
// can serve the SPA in production (single deployable service on Railway).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
});
