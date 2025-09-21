import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export function wgslPlugin(): Plugin {
  return {
    name: 'vite-plugin-wgsl',
    transform(code: string, id: string) {
      if (id.endsWith('.wgsl')) {
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null,
        };
      }
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.wgsl')) {
        server.ws.send({
          type: 'full-reload',
        });
      }
    },
  };
}