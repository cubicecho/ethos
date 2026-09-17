CREATE TABLE "habit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"habit_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_habit_entries_day" UNIQUE("habit_id","day")
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"color" text DEFAULT '#71717a' NOT NULL,
	"period" text DEFAULT 'day' NOT NULL,
	"target_count" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_habits_daily_target" CHECK ("period" <> 'day' or "target_count" = 1),
	CONSTRAINT "ck_habits_target_positive" CHECK ("target_count" > 0),
	CONSTRAINT "ck_habits_period" CHECK ("period" in ('day', 'week', 'month'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_habit_entries_user_id" ON "habit_entries" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_habit_entries_habit_id" ON "habit_entries" ("habit_id");--> statement-breakpoint
CREATE INDEX "idx_habit_entries_day" ON "habit_entries" ("day");--> statement-breakpoint
CREATE INDEX "idx_habits_user_id" ON "habits" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_habits_archived_at" ON "habits" ("archived_at");--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_habit_id_habits_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;