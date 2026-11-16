ALTER TABLE "habit_entries" ADD COLUMN "amount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD COLUMN "daily_amount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "daily_amount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "ck_habit_entries_amount_positive" CHECK ("amount" >= 1);--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "ck_habit_entries_short_is_partial" CHECK ("status" <> 'done' or "amount" >= "daily_amount" or "partial");--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "ck_habits_daily_amount_positive" CHECK ("daily_amount" > 0);