import { defineConfig } from "vite";

// Config allineata a Tauri: porta fissa 1420, niente clear screen.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
});
