import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@terraforming/engine': path.resolve(__dirname, '../../packages/engine/src'),
      '@terraforming/types': path.resolve(__dirname, '../../packages/types/src'),
      '@playground': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['three'],
  },
  server: {
    open: true,
  },
});
