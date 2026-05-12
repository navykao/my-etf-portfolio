import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// ระบบป้องกันหน้าจอขาว (Error Boundary)
window.onerror = function(message, source, lineno, colno, error) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; color: #dc2626; font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2 style="font-size: 20px; margin-bottom: 10px;">⚠️ พบปัญหาในการโหลดแอปพลิเคชัน</h2>
        <p style="font-size: 14px; background: #fee2e2; padding: 10px; border-radius: 8px; word-break: break-all;">
          ${message}
        </p>
        <p style="font-size: 12px; color: #64748b; margin-top: 20px;">โปรดตรวจสอบชื่อไฟล์ App.jsx ว่าพิมพ์ใหญ่เล็กถูกต้องหรือไม่</p>
      </div>
    `;
  }
  return false;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
