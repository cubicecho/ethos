import { graphql } from '@/__generated__';

// Every document the app sends, in one place. The generated CRUD is wide — most
// of it is filters and pagination this app has no use for — so these are the
// deliberate slice of it Ethos actually reads and writes.
//
// The fragments below are load-bearing rather than tidy: a mutation writes its
// result straight into the query's cache entry, so the two selections have to
// agree exactly — down to a field's arguments, which are part of the key Apollo
// stores a field under. Sharing one fragment is what makes that true by
// construction: a field added to a list is a field the mutation starts
// returning, instead of a half-written entity the next read has to go and fetch.
//
// That is also why `markHabit` and `clearHabit` return the whole habit rather
// than the entry row they wrote. A day changes the streak, this period's tally
// and the grid at once, all of them derived by the server from rows the client
// does not hold — so the entry alone would leave the screen showing a tick with
// yesterday's numbers beside it.
//
// `$today` runs through nearly every document for the same reason it is an
// argument at all: which day it is is the client's to say, and a field's
// arguments are part of its cache key, so a mutation that passed a different
// `today` than the query would write a second entry beside the one on screen
// instead of updating it.

export const HabitPeriodFieldsFragment = graphql(`
  fragment HabitPeriodFields on HabitPeriod {
    start
    end
    done
    skipped
    target
    effectiveTarget
    met
    rate
  }
`);

export const HabitFieldsFragment = graphql(`
  fragment HabitFields on Habit {
    id
    name
    notes
    color
    period
    targetCount
    position
    archivedAt
    streak(today: $today)
    longestStreak(today: $today)
    current(today: $today) {
      ...HabitPeriodFields
    }
    # Today's own entry, or nothing — an array of at most one, because the
    # unique index on (habit, day) is what makes it at most one. The tick on a
    # list screen has to know whether today is already done, already skipped or
    # untouched, and this period's tally cannot say: "1 of 3 this week" is the
    # same number whether the one was today or Monday.
    todayEntry: entries(where: { day: { eq: $today } }) {
      ...HabitEntryFields
    }
  }
`);

export const HabitEntryFieldsFragment = graphql(`
  fragment HabitEntryFields on HabitEntry {
    id
    day
    status
    note
  }
`);

/** How many periods the grid draws, and how many `HabitHistoryFields` asks for. */
export const HISTORY_PERIODS = 12;

/**
 * How many days of entries the detail screen holds.
 *
 * Twelve months is the widest window the grid ever draws — twelve periods of a
 * monthly habit — and 400 days covers it with room for the part-month at either
 * end. Bounded rather than open-ended because a habit kept for years would
 * otherwise send every day of it to draw one screen.
 */
export const ENTRY_WINDOW = 400;

/**
 * What the detail screen adds: the periods the streak was counted over, and the
 * days inside them.
 *
 * Both bounds are literals in the document rather than variables, so there is
 * nothing for a caller to pass consistently and nothing to get wrong: the
 * mutation below selects the same fragment, and a field's arguments are part of
 * its cache key, so identical literals are what makes a mark land in the grid
 * that is already on screen. The constants above are the same two numbers for
 * the code that has to reason about the window.
 */
export const HabitHistoryFieldsFragment = graphql(`
  fragment HabitHistoryFields on Habit {
    id
    history(periods: 12, today: $today) {
      ...HabitPeriodFields
    }
    entries(orderBy: { day: { direction: desc, priority: 1 } }, limit: 400) {
      ...HabitEntryFields
    }
  }
`);

export const HabitsDocument = graphql(`
  query Habits($today: String!) {
    habits(
      where: { archivedAt: { isNull: true } }
      orderBy: { position: { direction: asc, priority: 1 }, createdAt: { direction: asc, priority: 2 } }
    ) {
      ...HabitFields
    }
  }
`);

export const ArchivedHabitsDocument = graphql(`
  query ArchivedHabits($today: String!) {
    habits(
      where: { archivedAt: { isNotNull: true } }
      orderBy: { archivedAt: { direction: desc, priority: 1 } }
    ) {
      ...HabitFields
    }
  }
`);

export const HabitDocument = graphql(`
  query Habit($id: UUID!, $today: String!) {
    habit(where: { id: { eq: $id } }) {
      ...HabitFields
      ...HabitHistoryFields
      createdAt
    }
  }
`);

export const MeDocument = graphql(`
  query Me {
    users {
      id
      email
      name
    }
  }
`);

export const CreateHabitDocument = graphql(`
  mutation CreateHabit($values: CreateHabitInput!, $today: String!) {
    createHabit(values: $values) {
      ...HabitFields
    }
  }
`);

export const UpdateHabitDocument = graphql(`
  mutation UpdateHabit($id: UUID!, $set: UpdateHabitInput!, $today: String!) {
    updateHabit(set: $set, where: { id: { eq: $id } }) {
      ...HabitFields
    }
  }
`);

export const DeleteHabitDocument = graphql(`
  mutation DeleteHabit($id: UUID!) {
    deleteHabit(where: { id: { eq: $id } }) {
      id
    }
  }
`);

// Two shapes of the same two mutations, and the duplication is the point: the
// list screens hold no history, so asking for it on every tick would fetch a
// grid nothing is showing, and the detail screen holds one, so *not* asking
// would leave its squares a period behind the streak above them. Each screen
// sends the version whose selection matches what it is displaying.

export const MarkHabitDocument = graphql(`
  mutation MarkHabit($habitId: ID!, $day: String!, $status: String, $today: String!) {
    markHabit(habitId: $habitId, day: $day, status: $status) {
      ...HabitFields
    }
  }
`);

export const ClearHabitDocument = graphql(`
  mutation ClearHabit($habitId: ID!, $day: String!, $today: String!) {
    clearHabit(habitId: $habitId, day: $day) {
      ...HabitFields
    }
  }
`);

export const MarkHabitDayDocument = graphql(`
  mutation MarkHabitDay($habitId: ID!, $day: String!, $status: String, $today: String!) {
    markHabit(habitId: $habitId, day: $day, status: $status) {
      ...HabitFields
      ...HabitHistoryFields
    }
  }
`);

export const ClearHabitDayDocument = graphql(`
  mutation ClearHabitDay($habitId: ID!, $day: String!, $today: String!) {
    clearHabit(habitId: $habitId, day: $day) {
      ...HabitFields
      ...HabitHistoryFields
    }
  }
`);

export const RequestMagicLinkDocument = graphql(`
  mutation RequestMagicLink($email: String!) {
    requestMagicLink(email: $email) {
      ok
      magicLink
      token
      userId
    }
  }
`);

export const VerifyMagicLinkDocument = graphql(`
  mutation VerifyMagicLink($token: String!) {
    verifyMagicLink(token: $token) {
      token
      userId
    }
  }
`);
