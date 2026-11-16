import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_ROLE': JSON.stringify('user') },
  server: { host: '0.0.0.0', port: 5174, strictPort: true },
})
