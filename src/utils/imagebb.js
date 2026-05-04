/**
 * Helper para subir imágenes a ImageBB.
 * La API key se lee de VITE_IMGBB_API_KEY (env var).
 * En desarrollo: .env.local
 * En producción: variables de entorno de Vercel.
 */

const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload'

function getApiKey() {
  const key = import.meta.env.VITE_IMGBB_API_KEY
  if (!key) {
    throw new Error(
      'No hay API key de ImageBB configurada. ' +
      'Agrega VITE_IMGBB_API_KEY a tu .env.local (dev) o variables de entorno (prod).'
    )
  }
  return key
}

/**
 * Comprime una imagen antes de subirla.
 * - Lado mayor max 1024px
 * - Calidad JPEG 0.85
 * - Output: Blob (image/jpeg)
 */
export async function compressImage(file, { maxSize = 1024, quality = 0.85 } = {}) {
  // Convertir File a HTMLImageElement
  const img = await loadImage(file)

  // Calcular nuevas dimensiones manteniendo aspect ratio
  const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1)
  const w = Math.round(img.width * ratio)
  const h = Math.round(img.height * ratio)

  // Dibujar en canvas
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)

  // Convertir a Blob JPEG
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen')),
      'image/jpeg',
      quality,
    )
  })
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.src = e.target.result
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

/**
 * Sube un Blob (o File) a ImageBB.
 * Devuelve { url, displayUrl, deleteUrl, thumbUrl }.
 *
 * En caso de error de red o API: lanza error con mensaje claro.
 */
export async function uploadToImageBB(blob, { onProgress } = {}) {
  const apiKey = getApiKey()

  const formData = new FormData()
  formData.append('image', blob)
  // expiration vacío → la imagen no expira

  let response
  try {
    response = await fetch(`${IMGBB_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    throw new Error('Sin conexión. Verifica tu internet e intenta de nuevo.')
  }

  if (!response.ok) {
    throw new Error(`Error del servidor (${response.status}). Intenta de nuevo.`)
  }

  let json
  try {
    json = await response.json()
  } catch {
    throw new Error('Respuesta inesperada del servidor.')
  }

  if (!json.success) {
    const msg = json.error?.message || 'No pudimos subir la foto.'
    throw new Error(msg)
  }

  return {
    url: json.data.url,
    displayUrl: json.data.display_url,
    deleteUrl: json.data.delete_url,
    thumbUrl: json.data.thumb?.url,
    width: json.data.width,
    height: json.data.height,
    size: json.data.size,
  }
}

/**
 * Comprime + sube en un solo paso. Helper de conveniencia.
 */
export async function compressAndUpload(file) {
  const compressed = await compressImage(file)
  return uploadToImageBB(compressed)
}
