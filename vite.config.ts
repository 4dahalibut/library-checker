import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 5555,
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        holds: resolve(__dirname, "holds.html"),
      },
    },
  },
});
