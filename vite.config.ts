import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        hud: path.resolve(__dirname, "src/renderer/hud.html"),
        settings: path.resolve(__dirname, "src/renderer/settings.html"),
        capture: path.resolve(__dirname, "src/renderer/capture.html"),
        "price-overlay": path.resolve(__dirname, "src/renderer/price-overlay.html"),
        update: path.resolve(__dirname, "src/renderer/update.html"),
      },
    },
  },
  server: {
    port: 5173,
  },
});
