import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    sourcemap: true, // Use inline source maps for better error traces
    minify: false,   // Disable minification for better debugging
    rollupOptions: {
      input: {
        'build-config': path.resolve(__dirname, 'src/main-build-config.ts'),
        'report-issue': path.resolve(__dirname, 'src/main-report-issue.ts'),
        'environment-validator': path.resolve(__dirname, 'src/main-environment-validator.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Ensure source map contents are included
        sourcemapExcludeSources: false
      },
      external: ['node_modules/@vscode-elements/elements/dist/bundled.js'],
    }
  },
  // Make sure the source root is correctly set
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Enable better source map handling
  server: {
    sourcemapIgnoreList: false
  }
});
