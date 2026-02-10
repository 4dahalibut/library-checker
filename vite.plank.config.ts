import { defineConfig } from "vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/plank/",
  server: {
    port: 5556,
    proxy: {
      "/plank/api": "http://localhost:3456",
    },
    open: "/plank.html",
  },
  appType: "mpa",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^\/plank\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "plank-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        name: "Plank Leaderboard",
        short_name: "Plank",
        description: "Track and compare plank times with friends",
        theme_color: "#f0f0f0",
        background_color: "#f0f0f0",
        display: "standalone",
        start_url: "/plank/",
        scope: "/plank/",
        icons: [
          {
            src: "/plank/icons/plank-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
          },
          {
            src: "/plank/icons/plank-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
          },
          {
            src: "/plank/icons/plank-maskable.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
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
