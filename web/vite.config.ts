import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Seed data lives at the repo root so the .NET agent can share it.
  server: { fs: { allow: ['..'] } },
})
