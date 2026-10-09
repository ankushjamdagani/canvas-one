import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code changes rarely: keep it in its own cacheable chunks so app chunks
        // stay small (React on the entry path, the canvas library in the workspace chunk).
        codeSplitting: {
          groups: [
            { name: "ui-vendor", test: /node_modules.*@radix-ui/ },
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "canvas-vendor", test: /node_modules[\\/](@xyflow|d3-[a-z-]+|react-resizable-panels)[\\/]/ },
            { name: "storage-vendor", test: /node_modules[\\/]dexie[\\/]/ },
          ],
        },
      },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
