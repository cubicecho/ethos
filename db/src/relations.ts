import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

// This config — not the table list — is what drizzle-graphql reads, so a table
// with no entry here gets no relation fields in the API.
export const relations = defineRelations(schema, (helpers) => ({
  users: {
    habits: helpers.many.habits({ from: helpers.users.id, to: helpers.habits.userId }),
    habitEntries: helpers.many.habitEntries({ from: helpers.users.id, to: helpers.habitEntries.userId }),
  },

  habits: {
    user: helpers.one.users({ from: helpers.habits.userId, to: helpers.users.id }),
    entries: helpers.many.habitEntries({ from: helpers.habits.id, to: helpers.habitEntries.habitId }),
  },

  habitEntries: {
    user: helpers.one.users({ from: helpers.habitEntries.userId, to: helpers.users.id }),
    habit: helpers.one.habits({ from: helpers.habitEntries.habitId, to: helpers.habits.id }),
  },
}));
