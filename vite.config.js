import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ตั้งค่าเบื้องต้นสำหรับ Vercel
export default defineConfig({
  plugins: [react()],
})
