# Kumari Bites

Food-truck ordering, menu management, billing, and real-time order management system.

## Project Status

**Phase:** Foundation setup  
**Default branch:** main

## Product Scope

- Admin authentication and role-based access
- Menu categories and menu items
- Item pricing management
- Offers, combos, and coupons
- Customer QR ordering
- Cart and order placement
- Cash and online payment tracking
- Real-time order status updates
- Admin order / kitchen workflow
- PDF invoice generation
- WhatsApp invoice / notification integration
- Thermal order printing
- Sales dashboard and reports
- Top-selling / growth-oriented item insights

## Technology Direction

| Area | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js + Fastify + TypeScript |
| Database | MySQL |
| ORM | Drizzle ORM |
| Realtime | WebSocket (ws) |
| Validation | Zod |
| UI | Tailwind CSS + shadcn/ui |
| Authentication | HTTP-only secure cookies / session-based auth |
| Theme | Configurable palette; default Terracotta + Cream + Deep Brown |

### Theme

The application uses a **global configurable theme palette** managed from the backend Settings screen.

**Default palette:** Terracotta + Cream + Deep Brown.

Planned palette options include:
- Terracotta + Cream + Deep Brown
- Saffron + Dark Brown + Ivory
- Custom palette

Changing the selected palette in Settings should apply the primary theme tokens consistently across Dashboard, Orders, Menu, Reports, and Settings.

## Planned Backend Modules

1. Auth
2. Users
3. Roles & Permissions
4. Categories
5. Menu Items
6. Pricing
7. Offers / Combos
8. Coupons
9. Orders
10. Payments
11. Invoices
12. Reports
13. Realtime Order Events

## Initial Database Entities

- users
- roles
- permissions
- role_permissions
- categories
- menu_items
- menu_item_prices
- offers
- coupons
- orders
- order_items
- payments
- invoices

## Order Flow

Customer QR scan → Menu → Cart → Place Order → Payment → Real-time Admin/Kitchen Update → Preparation → Ready/Completed → PDF Invoice → WhatsApp notification.

## Development Rules

- Keep the initial stack lightweight and free-tier friendly.
- Avoid unnecessary infrastructure until the product needs it.
- Keep realtime communication inside the Node.js backend.
- Keep database access typed through Drizzle ORM.
- Keep validation centralized with Zod.
- Document every finalized architecture or configuration change in this README.
- Prefer simple, fast, maintainable implementations over premature scaling.

## Backend Foundation

The backend lives under `backend/` and is currently structured around Fastify + TypeScript, MySQL + Drizzle ORM, Zod validation, and WebSocket realtime communication.

### Backend Layout

```
backend/
├── src/
│   ├── config/env.ts
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── realtime/socket.ts
│   ├── app.ts
│   └── server.ts
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

### Initial Endpoints

- `GET /health` — backend health status
- `GET /api/v1` — API version/service information
- `WS /ws` — realtime connection foundation

### Local Backend Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

The default development server listens on `127.0.0.1:4000`.

Database migrations are managed with Drizzle Kit:

```bash
npm run generate
npm run migrate
```

## Current Milestone

- [x] Repository initialized
- [x] Main branch confirmed
- [x] Product scope documented
- [x] Initial stack documented
- [x] Global configurable theme direction documented
- [x] Default Terracotta + Cream + Deep Brown palette documented
- [x] Backend TypeScript / Fastify scaffold
- [x] Environment configuration
- [x] MySQL / Drizzle base connection
- [x] Drizzle Kit migration configuration
- [x] Health and API version endpoints
- [x] WebSocket foundation
- [x] Backend local development scripts
- [ ] Authentication
- [ ] Roles & permissions
- [ ] Menu management
- [ ] Order management
- [ ] WebSocket events
- [ ] Reports
- [ ] Invoice generation
- [ ] WhatsApp integration
- [ ] Printing integration
