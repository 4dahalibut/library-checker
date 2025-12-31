import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/plank/",
  server: {
    port: 5556,
    proxy: {
      "/api": {
        target: "http://localhost:3456",
        rewrite: (path) => `/plank${path}`,
      },
    },
    open: "/plank.html",
  },
  appType: "mpa",
  build: {
    outDir: "dist/plank-client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "plank.html"),
      },
    },
  },
});
