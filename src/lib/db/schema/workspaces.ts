import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const workspaceKind = pgEnum("workspace_kind", ["guest", "account"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("My workspace"),
    kind: workspaceKind("kind").notNull().default("guest"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_owner_active_idx")
      .on(t.ownerUserId)
      .where(sql`deleted_at is null`),
    index("workspaces_expires_idx").on(t.expiresAt),
  ],
);
