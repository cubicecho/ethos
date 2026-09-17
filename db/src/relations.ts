import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

// This config — not the table list — is what drizzle-graphql reads, so a table
// with no entry here gets no relation fields in the API.
export const relations = defineRelations(schema, (r) => ({
  users: {
    habits: r.many.habits({ from: r.users.id, to: r.habits.userId }),
    habitEntries: r.many.habitEntries({ from: r.users.id, to: r.habitEntries.userId }),
  },

  habits: {
    user: r.one.users({ from: r.habits.userId, to: r.users.id }),
    entries: r.many.habitEntries({ from: r.habits.id, to: r.habitEntries.habitId }),
  },

  habitEntries: {
    user: r.one.users({ from: r.habitEntries.userId, to: r.users.id }),
    habit: r.one.habits({ from: r.habitEntries.habitId, to: r.habits.id }),
  },
}));
