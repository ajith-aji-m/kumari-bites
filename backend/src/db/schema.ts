import {
  int,
  mysqlTable,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";

export const healthChecks = mysqlTable("health_checks", {
  id: int("id").autoincrement().primaryKey(),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
