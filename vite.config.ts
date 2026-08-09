import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "prompt",
      manifest: {
        id: "/",
        lang: "ja",
        name: "LAST BEACON — 最後の灯火",
        short_name: "LAST BEACON",
        description: "廃材を集め、灯火を強化し、安全圏を広げて生存者を救う短時間サバイバルゲーム。",
        theme_color: "#070b0d",
        background_color: "#020405",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2,webmanifest}"],
        cleanupOutdatedCaches: true
      }
    })
  ]
});
