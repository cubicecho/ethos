ALTER TABLE "users" DROP CONSTRAINT "users_email_key";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email");--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "ck_habit_entries_status" CHECK ("status" in ('done', 'skipped'));