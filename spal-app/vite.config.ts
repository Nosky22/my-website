import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/spal/',
  build: {
    outDir: '../spal',
    // Required: Vite refuses to empty a directory outside the project root
    // without this explicit opt-in
    emptyOutDir: true,
  },
})
