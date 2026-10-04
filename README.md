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
| Theme | Crimson Orange |

### Theme

The primary visual direction is **Crimson Orange**, supported by neutral surfaces, strong contrast, clean typography, and smooth interaction states.

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

## Current Milestone

- [x] Repository initialized
- [x] Main branch confirmed
- [x] Product scope documented
- [x] Initial stack documented
- [x] Crimson Orange theme documented
- [ ] Backend project scaffold
- [ ] MySQL / Drizzle configuration
- [ ] Authentication
- [ ] Roles & permissions
- [ ] Menu management
- [ ] Order management
- [ ] WebSocket events
- [ ] Reports
- [ ] Invoice generation
- [ ] WhatsApp integration
- [ ] Printing integration
