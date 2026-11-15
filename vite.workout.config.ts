import { defineConfig } from "vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/workout/",
  server: {
    port: 5558,
    proxy: {
      "/workout/api": "http://localhost:3456",
    },
    open: "/workout/workout.html",
  },
  appType: "mpa",
  plugins: [
    VitePWA({
      // Manifest only: saving needs the network anyway, and a caching
      // service worker would show the previous build after each deploy
      selfDestroying: true,
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: null,
      },
      manifest: {
        name: "Workouts",
        short_name: "Workouts",
        description: "Workout sequences with a checklist for each day",
        theme_color: "#ebe6ff",
        background_color: "#ebe6ff",
        display: "standalone",
        start_url: "/workout/",
        scope: "/workout/",
        icons: [
          {
            src: "/workout/icons/workout-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/workout/icons/workout-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/workout/icons/workout-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist/workout-client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "workout.html"),
      },
    },
  },
});
