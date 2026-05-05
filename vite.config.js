import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['Logo.png'],
      manifest: {
        name: 'TodyPan',
        short_name: 'TodyPan',
        description: 'Gestión financiera para tus panaderías',
        theme_color: '#C88F6A',
        background_color: '#FAF7F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'Logo.png', sizes: '192x192', type: 'image/png' },
          { src: 'Logo.png', sizes: '512x512', type: 'image/png' },
          { src: 'Logo.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // El handler de Firebase Auth (/__/auth/*) NO debe ser interceptado
        // por el SW: rompería el flujo de login con Google en PWA.
        navigateFallbackDenylist: [/^\/__\/auth\//],
        // Activar la nueva versión del SW de inmediato (sin esperar a que se
        // cierren todas las pestañas). Crítico para que un fix llegue a los
        // celulares ya cacheados.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
