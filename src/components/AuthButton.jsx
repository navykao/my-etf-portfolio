// src/components/AuthButton.jsx
// ปุ่ม Google Login/Logout — วางใน <nav> ได้เลย

import React from "react";

/**
 * Props:
 *  user     - Firebase User object (null = ยังไม่ login)
 *  loading  - bool: กำลัง restore session อยู่
 *  onSignIn  - function
 *  onSignOut - function
 */
export default function AuthButton({ user, loading, onSignIn, onSignOut }) {
  if (loading) {
    return (
      <div style={styles.skeleton} />
    );
  }

  if (!user) {
    return (
      <button onClick={onSignIn} style={styles.loginBtn} title="Sign in with Google">
        <GoogleIcon />
        <span>Sign in</span>
      </button>
    );
  }

  return (
    <div style={styles.userArea}>
      {user.photoURL ? (
        <img src={user.photoURL} alt={user.displayName} style={styles.avatar} referrerPolicy="no-referrer" />
      ) : (
        <div style={styles.avatarFallback}>
          {user.displayName?.[0] ?? "U"}
        </div>
      )}
      <span style={styles.displayName}>{user.displayName?.split(" ")[0]}</span>
      <button onClick={onSignOut} style={styles.logoutBtn} title="Sign out">
        ออก
      </button>
    </div>
  );
}

// ── Google "G" SVG icon ────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

// ── Inline styles (ไม่กระทบ App.css ที่มีอยู่) ────────────────────────────
const styles = {
  skeleton: {
    width: 100,
    height: 36,
    background: "#e2e8f0",
    borderRadius: 8,
    animation: "pulse 1.5s ease-in-out infinite",
  },
  loginBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    fontSize: 14,
    color: "#0f172a",
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(15,23,42,0.08)",
    transition: "box-shadow 0.2s",
  },
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    objectFit: "cover",
    border: "2px solid #e2e8f0",
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#1e40af",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 14,
  },
  displayName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#0f172a",
  },
  logoutBtn: {
    padding: "5px 12px",
    background: "transparent",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  },
};
