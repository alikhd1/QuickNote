import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bundle goes to dist-web/, not the usual dist/: dist/ already holds the built
// QuickNote.exe and is referenced by build.ps1 and the README.
export default defineConfig({
  plugins: [react()],
  // Tauri prints its own build output; do not wipe it.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    // WebView2 is evergreen Chromium, so there is no old browser to support.
    target: "chrome110",
    sourcemap: false,
  },
});
