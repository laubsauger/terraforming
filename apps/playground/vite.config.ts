import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { wgslPlugin } from './vite-plugin-wgsl';

export default defineConfig({
  plugins: [react(), tailwindcss(), wgslPlugin()],
  resolve: {
    alias: {
      '@terraforming/engine': path.resolve(__dirname, '../../packages/engine/src'),
      '@terraforming/types': path.resolve(__dirname, '../../packages/types/dist'),
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
