import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Load .env.test or .env into process.env if available
const envFile = fs.existsSync(path.resolve(__dirname, '.env.test'))
  ? '.env.test'
  : fs.existsSync(path.resolve(__dirname, '.env'))
    ? '.env'
    : null

if (envFile) {
  const envContent = fs.readFileSync(path.resolve(__dirname, envFile), 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=')
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim()
        const value = trimmed.slice(idx + 1).trim()
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    }
  }
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    exclude: ['tests/e2e/**/*.spec.ts', '**/node_modules/**'],
  },
})

