import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'

// Auto-actualiza el service worker: si hay nueva versión, recarga la página
// para garantizar que el código nuevo entre en vigor (clave para fix de auth).
registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload()
  },
})

createRoot(document.getElementById('root')).render(<App />)
