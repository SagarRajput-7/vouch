DROP INDEX "workspaces_owner_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_owner_active_idx" ON "workspaces" USING btree ("owner_user_id") WHERE deleted_at is null;