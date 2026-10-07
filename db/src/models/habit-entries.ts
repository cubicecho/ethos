import { date, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { habits } from './habits.ts';
import { users } from './users.ts';

/** What a day says. A skip is not a miss — see streaks.ts. */
export const ENTRY_STATUSES = ['done', 'skipped'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/**
 * One row per habit per day.
 *
 * `day` is a `date`, not a timestamp, and it is stored as the `YYYY-MM-DD` the
 * client sent. A habit kept at 11pm on Tuesday is a Tuesday, in the keeper's own
 * zone, and no server in another one gets to reinterpret it. That is also why
 * nothing here converts: the string goes in as it arrives and comes out the
 * same, so a habit cannot shift a day by being read from somewhere else.
 */
export const habitEntries = pgTable(
  'habit_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    status: text('status').notNull().$type<EntryStatus>().default('done'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The day is the key, so a double-click, two tabs and a retried request are
    // all the same tick: `markHabit` upserts onto this constraint.
    unique('uq_habit_entries_day').on(table.habitId, table.day),
    index('idx_habit_entries_user_id').on(table.userId),
    index('idx_habit_entries_habit_id').on(table.habitId),
    index('idx_habit_entries_day').on(table.day),
  ],
);

export type HabitEntry = typeof habitEntries.$inferSelect;
export type NewHabitEntry = typeof habitEntries.$inferInsert;
