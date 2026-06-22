import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/calendar/",
  server: {
    port: 5557,
    proxy: {
      "/calendar/api": "http://localhost:3456",
    },
    open: "/calendar/calendar.html",
  },
  appType: "mpa",
  build: {
    outDir: "dist/calendar-client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "calendar.html"),
      },
    },
  },
});
