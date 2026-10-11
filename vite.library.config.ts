import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { esmExternalRequirePlugin } from 'rolldown/plugins';
// @ts-expect-error Build-only ESM utility.
import { scopedCss } from './scripts/scoped-css.mjs';

export default defineConfig({
  publicDir: 'apps/web/public',
  base: './',
  plugins: [esmExternalRequirePlugin({ external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'] }), tailwind(), react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  css: { postcss: { plugins: [scopedCss()] } },
  build: {
    outDir: 'dist-react',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      input: 'src/embed/library.ts',
      preserveEntrySignatures: 'strict',
      output: {
        banner: '"use client";',
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: asset => asset.names?.some(name => name.endsWith('.css')) ? 'styles.css' : 'assets/[name]-[hash][extname]',
        codeSplitting: { groups: [
          { name: 'ui-vendor', test: /node_modules.*@radix-ui/ },
          { name: 'canvas-vendor', test: /node_modules[\\/](@xyflow|d3-[a-z-]+|react-resizable-panels)[\\/]/ },
          { name: 'storage-vendor', test: /node_modules[\\/]dexie[\\/]/ },
        ] },
      },
    },
  },
});
