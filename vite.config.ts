import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5555,
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
});
