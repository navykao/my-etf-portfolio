import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ตั้งค่าสำหรับให้ Vercel สร้างเว็บไซต์ได้อย่างถูกต้อง
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  }
})
