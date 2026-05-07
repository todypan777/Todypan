import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['Logo.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'TodyPan',
        short_name: 'TodyPan',
        description: 'Gestión financiera para tus panaderías',
        theme_color: '#C88F6A',
        background_color: '#FAF7F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // Iconos del tamano correcto (generados con sharp desde Logo.png).
        // Antes apuntaba al Logo.png 1024x1024 declarandolo como 192/512,
        // lo cual hacia que Chrome rechazara el manifest y NO disparara
        // beforeinstallprompt -> no salia el banner nativo de instalacion.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // El handler de Firebase Auth (/__/auth/*) NO debe ser interceptado
        // por el SW: rompería el flujo de login con Google en PWA.
        navigateFallbackDenylist: [/^\/__\/auth\//],
        // skipWaiting + clientsClaim removidos a propósito: cuando estaban
        // activos, cada deploy a Vercel mientras una cajera vendía hacía que
        // el SW nuevo tomara control inmediato y rompiera el refresh de token
        // de Firebase Auth → la cajera quedaba deslogueada en medio de la venta.
        // Ahora el SW nuevo se instala en background pero solo toma control en
        // el siguiente arranque limpio de la app (cerrar y volver a abrir),
        // sin interrumpir la sesión activa.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
