# Service Reminder — Backend API

NestJS + MongoDB backend for the Service Reminder app (see [`../project.md`](../project.md)
for the full product spec). Implements the core loop: **Customer → Service → Warranty →
Next Reminder → WhatsApp**.

## What's implemented

- **Auth** — phone + OTP login. No SMS provider is wired up yet: the OTP is logged
  server-side and echoed back in the response as `devCode` outside of production, so
  the flow is fully testable without an MSG91/Twilio account.
- **Businesses** — auto-created on first successful OTP verification.
- **Service presets** — per-business editable list of service types, seeded with
  `AC Gas Refill` / `AC General Service` / `AC Installation` for new businesses.
- **Customers** — CRUD, scoped to the authenticated business, enforces the free-tier
  customer cap (`FREE_TIER_CUSTOMER_LIMIT`, default 25).
- **Services** — log a service against a customer; warranty expiry and next-service
  date are computed server-side from the selected period/interval (or a custom date).
- **Reminders** — due-today / due-soon queries, a `wa.me` WhatsApp deep-link builder
  with a pre-filled message, and a daily cron job (`@nestjs/schedule`) that sweeps all
  businesses for due services. Push notification dispatch is stubbed (see TODO in
  `reminders.service.ts`) — there's no FCM wiring yet.
- **Subscriptions** — schema + a manual `/subscriptions/activate` endpoint for
  dev/testing. Razorpay checkout and webhook signature verification are **not**
  implemented — `subscriptions.service.ts` has TODOs marking exactly where that goes.

Not built: FCM push notifications, Razorpay integration, the digital service card web
page, and the mobile app itself — this repo is the backend API only.

## Setup

Requires Node 18+ (project was built/tested on Node 20) and a MongoDB instance.

```bash
npm install
cp .env.example .env   # then edit JWT_SECRET, MONGODB_URI, etc.
```

Start MongoDB locally, either via Docker:

```bash
docker compose up -d
```

or against any MongoDB instance you already have running (local `mongod`, or a
MongoDB Atlas connection string) by pointing `MONGODB_URI` at it. In production, use
MongoDB Atlas.

## Run

```bash
npm run start:dev     # watch mode
npm run start         # single run
npm run build && npm run start:prod
```

The API is served under the `/api` prefix, e.g. `http://localhost:3000/api/health`.

## Test

```bash
npm run test       # unit tests
npm run test:e2e   # e2e tests (needs MongoDB reachable via MONGODB_URI)
```

## API overview

All endpoints except `/auth/*`, `/health`, and the Razorpay webhook require
`Authorization: Bearer <token>` from `/auth/verify-otp`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/request-otp` | `{ phone }` → sends (logs) a 6-digit OTP |
| POST | `/api/auth/verify-otp` | `{ phone, code }` → `{ accessToken, business }` |
| GET/PATCH | `/api/businesses/me` | View/update business profile |
| GET | `/api/service-presets` | List this business's service types |
| POST | `/api/service-presets` | Add a custom service type |
| DELETE | `/api/service-presets/:id` | Remove a service type |
| POST | `/api/customers` | Add a customer (enforces free-tier cap) |
| GET | `/api/customers` | List customers |
| GET/PATCH/DELETE | `/api/customers/:id` | Single customer |
| POST | `/api/services` | Log a service (warranty + next-service-date computed) |
| GET | `/api/services/:id` | Service detail |
| GET | `/api/services?customerId=:id` | Service history for a customer |
| GET | `/api/reminders/due-today` | Services due today |
| GET | `/api/reminders/due-soon?days=7` | Services due in the next N days |
| GET | `/api/reminders/whatsapp-link/:serviceId` | `{ url, message }` — `wa.me` deep link |
| GET | `/api/subscriptions/me` | Current subscription |
| POST | `/api/subscriptions/activate` | Dev-only: mark business as paid |
| POST | `/api/subscriptions/webhook/razorpay` | Stub — not wired to real Razorpay yet |

### Example: `POST /api/services` body

```json
{
  "customerId": "<mongo id>",
  "serviceType": "AC General Service",
  "warrantyPeriod": "90d",
  "nextServiceInterval": "6m",
  "notes": "Replaced capacitor"
}
```

`warrantyPeriod` / `nextServiceInterval` accept `none|30d|90d|6m|1y|custom` and
`1m|3m|6m|1y|custom` respectively; when `custom` is chosen, also send
`customWarrantyDate` / `customNextServiceDate` as ISO dates.
# agla-kaam-backend
