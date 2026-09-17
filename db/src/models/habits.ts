import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * How often a habit is meant to happen. `day` means every day; `week` and
 * `month` mean `targetCount` days inside the period, whichever days those are.
 *
 * Deliberately three, and deliberately calendar-aligned: "3× a week" is what
 * people say, and a rolling seven-day window would make the same habit's streak
 * depend on when you asked. See periods.ts for where the boundaries are drawn.
 */
export const PERIODS = ['day', 'week', 'month'] as const;
export type Period = (typeof PERIODS)[number];

export const habits = pgTable(
  'habits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Why the habit is worth keeping, when a name cannot hold it. Nullable
    // rather than defaulted to '': "no note" and "an empty note" are the same
    // thing, and only one of them should be storable.
    notes: text('notes'),
    // The habit's colour on the grid, chosen by the user, so no theme token can
    // be trusted to read on it — see readable-text-color.ts.
    color: text('color').notNull().default('#71717a'),
    period: text('period').notNull().$type<Period>().default('day'),
    // How many days inside the period the habit asks for.
    targetCount: integer('target_count').notNull().default(1),
    position: integer('position').notNull().default(0),
    // An archived habit keeps its history and leaves the grid. Never deleted on
    // the user's behalf: the record of having kept it is most of the point.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_habits_user_id').on(t.userId),
    index('idx_habits_archived_at').on(t.archivedAt),
    // An entry is one day, and a day is either kept or it is not — so a daily
    // habit can only ever ask for one. Structural rather than a rule someone
    // has to remember: with `target_count = 3, period = 'day'` stored, every
    // rate in the app would divide by a number no day could reach.
    check('ck_habits_daily_target', sql`${t.period} <> 'day' or ${t.targetCount} = 1`),
    check('ck_habits_target_positive', sql`${t.targetCount} > 0`),
    check('ck_habits_period', sql`${t.period} in ('day', 'week', 'month')`),
  ],
);

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
