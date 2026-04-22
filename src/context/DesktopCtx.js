import { createContext, useContext } from 'react'

export const DesktopCtx = createContext(false)
export const useIsDesktop = () => useContext(DesktopCtx)
