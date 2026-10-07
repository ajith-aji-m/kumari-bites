# Kumari Bites

Food-truck ordering, menu management, billing, and real-time order management system.

## Project Status

**Phase:** Backend foundation + Admin UI foundation  
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
| Theme | Crimson Orange |

### Theme

**Kumari Bites** uses a Crimson Orange visual direction with warm neutral surfaces, dark readable text, rounded cards, and smooth interaction states. The theme should stay lightweight and consistent across Login, Dashboard, Orders, Menu, Offers, Reports, Users, and Settings.

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

## Database Design

The database is designed around the complete ordering and admin workflow.

### Core tables

- `users`, `roles`, `permissions`, `role_permissions` — admin authentication and access control
- `categories`, `menu_items`, `menu_item_prices` — menu catalog and price history
- `offers`, `offer_items`, `coupons` — promotions and discounts
- `orders`, `order_items`, `order_coupons` — customer orders; customer identity is kept on the order using phone/name, with no separate Customers module
- `payments` — cash, UPI, card and online payment records
- `invoices` — invoice number, generated PDF path and WhatsApp delivery state
- `order_status_events` — status history for realtime/order auditing
- `app_settings` — global settings and theme configuration
- `whatsapp_integrations` — WhatsApp provider/linking state and encrypted credentials
- `ai_integrations` — AI provider/model and encrypted API key
- `audit_logs` — admin activity history
- `health_checks` — application health foundation

### Important data rules

- Money uses fixed-point `DECIMAL(10,2)`, not floating point.
- Order items store the item name and unit price as a snapshot so historical invoices remain correct after menu changes.
- Secrets such as WhatsApp credentials and AI API keys are stored as encrypted server-side values; they are never returned to the React client.
- Customer data is intentionally order-centric; there is no standalone customer management page.
- Order status changes are recorded separately so WebSocket events and audit/history views can use the same source of truth.

The complete typed schema is in `src/db/schema.ts`.

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

## Application Architecture

The project is a **single Node.js application**. React is the frontend, while Fastify provides the API and the same Node.js process owns realtime WebSocket communication.

### Project Layout

```
kumari-bites/
├── src/
│   ├── frontend/          # React + Vite application
│   ├── server/            # Fastify HTTP/API layer
│   ├── db/                # Drizzle + MySQL
│   ├── realtime/          # WebSocket events
│   └── shared/            # Shared types and validation
├── public/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── .gitignore
└── README.md
```

### Single-Domain Deployment

The application is designed to run behind one domain:

- `https://kumari-bites.com/` → React application
- `https://kumari-bites.com/api/*` → Fastify API
- `wss://kumari-bites.com/ws` → WebSocket realtime channel

React, API, and WebSocket are therefore part of one deployable Node.js application. There is no separate `backend/` application directory.

### Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Database migrations:

```bash
npm run generate
npm run migrate
```

### Backend API Foundation

### Authentication

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

Authentication uses a hashed server-side session token stored in an HTTP-only cookie.

### Menu

- `GET /api/v1/categories` — requires `menu.view`
- `POST /api/v1/categories` — requires `menu.manage`
- `PATCH /api/v1/categories/:id` — requires `menu.manage`
- `DELETE /api/v1/categories/:id` — soft-deactivates a category
- `GET /api/v1/menu-items` — requires `menu.view`
- `POST /api/v1/menu-items` — requires `menu.manage`
- `PATCH /api/v1/menu-items/:id` — requires `menu.manage`; price changes create a new price record
- `DELETE /api/v1/menu-items/:id` — soft-disables an item

### Dashboard

- `GET /api/v1/dashboard` — requires `dashboard.view`
- Returns today's sales/order KPIs, active/completed/cancelled order counts, 7-day sales trend, top items, and recent orders.

### Offers & Coupons

- `GET /api/v1/offers` — requires `offers.view`
- `POST /api/v1/offers` — requires `offers.manage`
- `PATCH /api/v1/offers/:id` — requires `offers.manage`
- `DELETE /api/v1/offers/:id` — soft-deactivates an offer
- `GET /api/v1/coupons` — requires `offers.view`
- `POST /api/v1/coupons` — requires `offers.manage`
- `PATCH /api/v1/coupons/:id` — requires `offers.manage`
- `DELETE /api/v1/coupons/:id` — soft-deactivates a coupon
- `GET /api/v1/coupons/:code/validate` — validates an active coupon for order use

Percentage discounts are capped at 100%, offer/coupon date ranges are validated, and combo offers can reference menu items.

### Orders

- `GET /api/v1/orders` — requires `orders.view`
- `POST /api/v1/orders` — requires `orders.manage`
- `PATCH /api/v1/orders/:id/status` — requires `orders.manage`

Order creation broadcasts `order.created`. Status changes broadcast `order.status_changed`.

### Realtime

WebSocket endpoint: `/ws`

The realtime server runs inside the same Node.js/Fastify application; no separate realtime server is required for the MVP.

## Current Foundation

The current main branch contains the Node/Fastify foundation, environment validation, MySQL/Drizzle connection, migration configuration, health/API endpoints, and WebSocket foundation.

The first frontend milestone is now implemented in the same project: the Admin Login screen and Dashboard shell use React + Vite and the Terracotta + Cream + Deep Brown design direction. The login currently demonstrates the UI-to-dashboard transition; real credential validation and session persistence remain the next authentication step.

The React frontend lives under `src/frontend/` and does not create a separate backend application.

## Current Milestone

- [x] Repository initialized
- [x] Main branch confirmed
- [x] Product scope documented
- [x] Initial stack documented
- [x] Crimson Orange theme confirmed
- [x] Single-project architecture documented
- [x] Legacy `backend/` application directory removed
- [x] Backend TypeScript / Fastify scaffold
- [x] Authentication endpoints
- [x] HTTP-only session handling
- [x] Permission guard
- [x] Order API foundation
- [x] Realtime order-created/status events
- [x] Menu/category API foundation
- [x] Menu price history foundation
- [x] Offers and coupons API foundation
- [x] Dashboard analytics API foundation
- [x] Environment configuration
- [x] MySQL / Drizzle base connection
- [x] Drizzle Kit migration configuration
- [x] Health and API version endpoints
- [x] WebSocket foundation
- [x] Backend local development scripts
- [x] React frontend foundation
- [x] Admin Login screen
- [x] Dashboard screen shell
- [ ] Full authentication/session-aware frontend
- [ ] Roles & permissions UI
- [ ] Menu management
- [ ] Order management
- [ ] WebSocket events
- [ ] Reports
- [ ] Invoice generation
- [ ] WhatsApp integration
- [ ] Printing integration
