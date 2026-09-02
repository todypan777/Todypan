// Configuración de ESLint. `npm run lint` estaba roto: package.json llamaba a
// `eslint .` pero no existía ningún archivo de configuración, así que el
// comando fallaba antes de revisar una sola línea.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Variables sin usar: se avisan, no rompen el build. Las que empiezan
      // por mayúscula o guion bajo se ignoran (componentes y descartes
      // intencionales de desestructuración).
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': 'off',
      // `try { ... } catch {}` es un idioma usado a proposito en todo el
      // codigo (localStorage puede fallar y no hay nada que hacer al respecto).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Avisos, no errores: los patrones que marcan son legitimos aqui
      // (suscripciones que llaman setState, Date.now para calcular tiempos
      // transcurridos). Se dejan visibles para revisarlos con calma, pero sin
      // romper `npm run lint`.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]
