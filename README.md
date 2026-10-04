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

### Current Foundation

The current main branch contains the Node/Fastify foundation, environment validation, MySQL/Drizzle connection, migration configuration, health/API endpoints, and WebSocket foundation.

The React frontend directories are reserved in the unified project structure; feature implementation will be added there without creating a separate backend application.

## Current Milestone

- [x] Repository initialized
- [x] Main branch confirmed
- [x] Product scope documented
- [x] Initial stack documented
- [x] Global configurable theme direction documented
- [x] Default Terracotta + Cream + Deep Brown palette documented
- [x] Single-project architecture documented
- [x] Legacy `backend/` application directory removed
- [x] Backend TypeScript / Fastify scaffold
- [x] Environment configuration
- [x] MySQL / Drizzle base connection
- [x] Drizzle Kit migration configuration
- [x] Health and API version endpoints
- [x] WebSocket foundation
- [x] Backend local development scripts
- [ ] React frontend
- [ ] Authentication
- [ ] Roles & permissions
- [ ] Menu management
- [ ] Order management
- [ ] WebSocket events
- [ ] Reports
- [ ] Invoice generation
- [ ] WhatsApp integration
- [ ] Printing integration
