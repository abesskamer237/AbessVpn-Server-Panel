# 🛡️ AbessVpn Master Server & Reseller Management Panel

Enterprise-grade VPN Management Server and Reseller Portal for **AbessVpn**, featuring multi-protocol tunneling (VLESS over WebSocket with TLS/Reality), secure multi-role authentication (Super Admin & Resellers), dynamic GB bandwidth quotas, and complete configuration isolation.

## 🚀 Key Features

- **👑 Super Admin Portal (`rigomanga4@gmail.com`)**:
  - Full control over infrastructure: Host, Port, WebSocket path (`/@abess237`), SNI Bug Host, UUID, and AES-256 Master Key.
  - Reseller Account Management: Create, suspend, recharge credit balances (in GB/Credits).
  - Global Platform Analytics: Total bandwidth allocated, consumed, active client sessions, and circulation volume.
- **💼 Reseller Self-Service Space**:
  - Independent login and balance tracking.
  - Generate client licenses and tokens with custom GB limits and exact expiration dates.
  - **Zero-Leak Infrastructure Protection**: Resellers NEVER see the master server IP, Host, or SNI. Everything is exported as encrypted `abess://` links.
- **⚡ High-Performance Tunneling Engine**:
  - Built-in VLESS WebSocket handler listening on `/@abess237`.
  - Native client API on `POST /api/v1/auth/token` compatible with the `AbessVpn-Cyber` Android/iOS mobile apps.
  - Real-time bandwidth telemetry and automatic quota cut-off when limits are reached.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, TypeScript, `ws` (WebSocketServer), Node Crypto (AES-256-CBC)
- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, QRCode
- **Build System**: Vite, tsx

## 🏁 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Production build
npm run build
npm start
```

## 🔐 Default Super Admin Credentials

- **Email**: `rigomanga4@gmail.com`
- **Password**: `abess237`
- **Role**: `SUPER_ADMIN`
