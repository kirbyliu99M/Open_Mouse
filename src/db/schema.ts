import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

// Infrastructure only. The product schema belongs to M1.
export const scaffoldChecks = pgTable("scaffold_checks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
