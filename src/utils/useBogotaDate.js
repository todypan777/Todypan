import { useEffect, useState } from 'react'
import { getBogotaDateStr } from '../db'

/**
 * Hook reactivo: devuelve la fecha actual en zona Bogotá (YYYY-MM-DD).
 * Cuando pasa la medianoche, el valor se actualiza automáticamente — los
 * componentes que dependen de "el día de hoy" (menú del día, etc.) se
 * re-renderizan solos sin necesidad de refresh manual.
 *
 * Polling: cada 60 segundos. Suficiente para detectar el cambio de día sin
 * desperdiciar CPU.
 */
export function useBogotaDate() {
  const [date, setDate] = useState(() => getBogotaDateStr())

  useEffect(() => {
    const tick = () => {
      const now = getBogotaDateStr()
      // Solo actualizamos si realmente cambió, para no provocar re-renders.
      setDate(prev => (prev !== now ? now : prev))
    }
    // Chequeo inmediato + cada minuto
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  return date
}
