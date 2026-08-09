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
        description: "広い拠点を見回し、住民を配属して資源生産・施設強化・探索を進めるサバイバルゲーム。",
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
