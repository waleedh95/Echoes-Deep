import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const stripeOrdersTable = pgTable("stripe_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  echoAmount: integer("echo_amount").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStripeOrderSchema = createInsertSchema(stripeOrdersTable).omit({ id: true, createdAt: true });
export type InsertStripeOrder = z.infer<typeof insertStripeOrderSchema>;
export type StripeOrder = typeof stripeOrdersTable.$inferSelect;
