import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      // https://rollupjs.org/guide/en/#big-list-of-options
      output: {
        // ...
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
      },
      external: ['node_modules/@vscode-elements/elements/dist/bundled.js'],
    }
  }
});
