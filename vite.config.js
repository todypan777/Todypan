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
      },
    }),
  ],
})
