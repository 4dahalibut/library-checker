import { defineConfig } from "vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 5555,
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
  plugins: [
    {
      name: "rewrite-user-routes",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Rewrite /u/:username to /index.html for SPA routing
          if (req.url && /^\/u\/[^/]+\/?$/.test(req.url)) {
            req.url = "/index.html";
          }
          // Rewrite /u/:username/finished to /finished.html
          if (req.url && /^\/u\/[^/]+\/finished\/?$/.test(req.url)) {
            req.url = "/finished.html";
          }
          next();
        });
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
            },
          },
        ],
      },
      manifest: {
        name: "Book List - Library Checker",
        short_name: "Book List",
        description:
          "Want to Read + Carnegie Library of Pittsburgh availability",
        theme_color: "#f0f0f0",
        background_color: "#f0f0f0",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/books-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
          },
          {
            src: "/icons/books-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
          },
          {
            src: "/icons/books-maskable.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        holds: resolve(__dirname, "holds.html"),
        finished: resolve(__dirname, "finished.html"),
      },
    },
  },
});
