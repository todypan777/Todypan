import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyCQxi5ZWQYcpfdFX0db7UNeDRX-Oht8gEQ",
  authDomain: "todypan-47059.firebaseapp.com",
  projectId: "todypan-47059",
  storageBucket: "todypan-47059.firebasestorage.app",
  messagingSenderId: "1021735934495",
  appId: "1:1021735934495:web:87d89868cce8690a6b532a"
}

export const firebaseApp = initializeApp(firebaseConfig)
export const firestoreDb = getFirestore(firebaseApp)
export const firebaseAuth = getAuth(firebaseApp)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
