# 🛡️ AbessVpn Master Server & Reseller Management Panel

Administration and API control plane for **AbessVpn**. The project contains the admin/reseller panel, token issuance, licence validation, and mobile-client health/telemetry endpoints.

> **VPN data-plane status:** the repository does not currently include a working Xray/VLESS traffic relay. The WebSocket tunnel path deliberately returns HTTP 503 and `GET /api/v1/ping` reports `dataPlane: "not-ready"`. The mobile app refuses managed VPN connections in this state. Do not set the data plane to ready until a real Xray-core deployment has been configured and independently tested.

## 🚀 Current capabilities

- **👑 Super Admin panel**
  - Manage infrastructure configuration and reseller accounts.
  - View platform statistics and token inventory.
- **💼 Reseller panel**
  - Create licence tokens through an authenticated session.
  - Set quota, duration, and device limits.
  - View reseller credits and token status.
- **📱 Mobile API**
  - `POST /api/v1/auth/token` validates licences, expiry, quota, and registered-device limits.
  - `GET /api/v1/ping` reports control-plane health and the explicit data-plane status.
  - `GET /api/v1/speedtest/download` and `POST /api/v1/speedtest/upload` provide bounded HTTP throughput probes.
  - `POST /api/v1/client/telemetry` accepts client-reported traffic counters for compatibility/display. These counters are **not authoritative** and must not be treated as tamper-proof quota enforcement.
  - Trial issuance is disabled while a real data plane is unavailable. Token creation remains restricted to the authenticated admin/reseller panel.

## 🛠️ Tech stack

- **Backend:** Node.js, Express, TypeScript, `tsx`, Node Crypto
- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, QRCode
- **Build:** Vite

## 🏁 Quick start

```bash
npm install
npm run lint
npm run build
npm run dev
```

The default API port is `3000` (or the `PORT` environment variable).

## 🔐 First-run administrator

On first start only, the current seed data creates a demonstration Super Admin account. Change/remove seeded credentials and the master encryption secret before exposing this service to the Internet. The initial demo login shown by older versions of this README is not a production credential policy.

## ✅ Validation

The GitHub Actions workflow `.github/workflows/verify.yml` runs TypeScript checks, builds the panel, and smoke-tests the mobile API contracts and the disabled tunnel state.
