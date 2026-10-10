import {
  boolean,
  decimal,
  index,
  int,
  mediumtext,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull()
};

export const roles = mysqlTable("roles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: varchar("description", { length: 255 }),
  ...timestamps
}, (table) => [uniqueIndex("roles_name_uq").on(table.name)]);

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 190 }),
  phone: varchar("phone", { length: 30 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  roleId: int("role_id"),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at"),
  ...timestamps
}, (table) => [
  uniqueIndex("users_email_uq").on(table.email),
  uniqueIndex("users_phone_uq").on(table.phone),
  index("users_role_idx").on(table.roleId)
]);

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 120 }).notNull(),
  description: varchar("description", { length: 255 })
}, (table) => [uniqueIndex("permissions_key_uq").on(table.key)]);

export const rolePermissions = mysqlTable("role_permissions", {
  roleId: int("role_id").notNull(),
  permissionId: int("permission_id").notNull()
}, (table) => [uniqueIndex("role_permissions_uq").on(table.roleId, table.permissionId)]);

export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
  index("sessions_expires_idx").on(table.expiresAt)
]);

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  description: text("description"),
  imageUrl: mediumtext("image_url"),
  sortOrder: int("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("categories_slug_uq").on(table.slug),
  index("categories_active_idx").on(table.isActive)
]);

export const menuItems = mysqlTable("menu_items", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: int("category_id").notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull(),
  description: text("description"),
  imageUrl: mediumtext("image_url"),
  sku: varchar("sku", { length: 80 }),
  isVeg: boolean("is_veg").default(false).notNull(),
  isAvailable: boolean("is_available").default(true).notNull(),
  stockQuantity: int("stock_quantity").default(0).notNull(),
  lowStockThreshold: int("low_stock_threshold").default(5).notNull(),
  lowStockAlertEnabled: boolean("low_stock_alert_enabled").default(true).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("menu_items_slug_uq").on(table.slug),
  uniqueIndex("menu_items_sku_uq").on(table.sku),
  index("menu_items_category_idx").on(table.categoryId),
  index("menu_items_available_idx").on(table.isAvailable)
]);

export const menuItemPrices = mysqlTable("menu_item_prices", {
  id: int("id").autoincrement().primaryKey(),
  menuItemId: int("menu_item_id").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps
}, (table) => [index("menu_item_prices_item_idx").on(table.menuItemId), index("menu_item_prices_active_idx").on(table.isActive)]);

export const offers = mysqlTable("offers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  discountType: mysqlEnum("discount_type", ["percentage", "fixed"]).notNull(),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps
}, (table) => [index("offers_active_idx").on(table.isActive, table.startsAt)]);

export const offerItems = mysqlTable("offer_items", {
  offerId: int("offer_id").notNull(),
  menuItemId: int("menu_item_id").notNull(),
  quantity: int("quantity").default(1).notNull()
}, (table) => [uniqueIndex("offer_items_uq").on(table.offerId, table.menuItemId)]);

export const coupons = mysqlTable("coupons", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull(),
  description: varchar("description", { length: 255 }),
  discountType: mysqlEnum("discount_type", ["percentage", "fixed"]).notNull(),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }),
  maxDiscountAmount: decimal("max_discount_amount", { precision: 10, scale: 2 }),
  usageLimit: int("usage_limit"),
  usedCount: int("used_count").default(0).notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("coupons_code_uq").on(table.code), index("coupons_active_idx").on(table.isActive, table.startsAt)]);

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("order_number", { length: 40 }).notNull(),
  customerName: varchar("customer_name", { length: 120 }),
  customerPhone: varchar("customer_phone", { length: 30 }),
  source: mysqlEnum("source", ["qr", "admin", "walk_in"]).default("qr").notNull(),
  status: mysqlEnum("status", ["new", "confirmed", "preparing", "ready", "completed", "cancelled"]).default("new").notNull(),
  paymentStatus: mysqlEnum("payment_status", ["pending", "paid", "failed", "refunded", "partially_refunded"]).default("pending").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  placedAt: timestamp("placed_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  ...timestamps
}, (table) => [
  uniqueIndex("orders_number_uq").on(table.orderNumber),
  index("orders_phone_idx").on(table.customerPhone),
  index("orders_status_idx").on(table.status),
  index("orders_placed_at_idx").on(table.placedAt)
]);

export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  menuItemId: int("menu_item_id"),
  itemName: varchar("item_name", { length: 150 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  quantity: int("quantity").notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  lineTotal: decimal("line_total", { precision: 10, scale: 2 }).notNull(),
  notes: varchar("notes", { length: 500 })
}, (table) => [index("order_items_order_idx").on(table.orderId), index("order_items_menu_item_idx").on(table.menuItemId)]);

export const orderCoupons = mysqlTable("order_coupons", {
  orderId: int("order_id").notNull(),
  couponId: int("coupon_id").notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull()
}, (table) => [uniqueIndex("order_coupons_uq").on(table.orderId, table.couponId)]);

export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  method: mysqlEnum("method", ["cash", "upi", "card", "online", "other"]).notNull(),
  provider: varchar("provider", { length: 80 }),
  transactionReference: varchar("transaction_reference", { length: 190 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "success", "failed", "refunded"]).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  ...timestamps
}, (table) => [index("payments_order_idx").on(table.orderId), index("payments_reference_idx").on(table.transactionReference)]);

export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  pdfPath: varchar("pdf_path", { length: 500 }),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  whatsappSentAt: timestamp("whatsapp_sent_at"),
  ...timestamps
}, (table) => [uniqueIndex("invoices_order_uq").on(table.orderId), uniqueIndex("invoices_number_uq").on(table.invoiceNumber)]);

export const orderStatusEvents = mysqlTable("order_status_events", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  fromStatus: varchar("from_status", { length: 40 }),
  toStatus: varchar("to_status", { length: 40 }).notNull(),
  changedByUserId: int("changed_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (table) => [index("order_status_events_order_idx").on(table.orderId, table.createdAt)]);

export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 120 }).notNull(),
  value: text("value"),
  isSecret: boolean("is_secret").default(false).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("app_settings_key_uq").on(table.key)]);

export const whatsappIntegrations = mysqlTable("whatsapp_integrations", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 80 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 30 }),
  connectionStatus: mysqlEnum("connection_status", ["disconnected", "pending", "connected", "error"]).default("disconnected").notNull(),
  credentialsEncrypted: text("credentials_encrypted"),
  connectedAt: timestamp("connected_at"),
  ...timestamps
});

export const aiIntegrations = mysqlTable("ai_integrations", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 80 }).notNull(),
  model: varchar("model", { length: 120 }),
  apiKeyEncrypted: text("api_key_encrypted"),
  isActive: boolean("is_active").default(false).notNull(),
  ...timestamps
});

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id"),
  action: varchar("action", { length: 120 }).notNull(),
  entity: varchar("entity", { length: 80 }),
  entityId: int("entity_id"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (table) => [
  index("audit_logs_user_idx").on(table.userId),
  index("audit_logs_entity_idx").on(table.entity, table.entityId),
  index("audit_logs_created_at_idx").on(table.createdAt)
]);

export const healthChecks = mysqlTable("health_checks", {
  id: int("id").autoincrement().primaryKey(),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});