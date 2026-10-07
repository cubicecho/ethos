import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * How often a habit is meant to happen. `day` means every day; `week` and
 * `month` mean `targetCount` days inside the period, whichever days those are.
 *
 * Calendar-aligned on purpose: a rolling seven-day window would make the same
 * habit's streak depend on when you asked. See periods.ts for the boundaries.
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
    // Why the habit is worth keeping. Nullable rather than defaulted to '', so
    // "no note" and "an empty note" cannot both be stored.
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
  (table) => [
    index('idx_habits_user_id').on(table.userId),
    index('idx_habits_archived_at').on(table.archivedAt),
    // An entry is one day, so a daily habit can only ask for one. A stored
    // `target_count = 3, period = 'day'` would be a rate no day could reach.
    check('ck_habits_daily_target', sql`${table.period} <> 'day' or ${table.targetCount} = 1`),
    check('ck_habits_target_positive', sql`${table.targetCount} > 0`),
    check('ck_habits_period', sql`${table.period} in ('day', 'week', 'month')`),
  ],
);

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
