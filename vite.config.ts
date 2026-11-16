import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` is the Control Room on port 5173.
// The public User website must be started with `npm run dev:user` on 5174.
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_ROLE': JSON.stringify('control-room') },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
})
