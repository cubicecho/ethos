import { graphql } from '@/__generated__';

// Every document the app sends: the slice of the generated CRUD Ethos uses.
//
// The fragments are load-bearing: a mutation writes its result straight into
// the query's cache entry, so the two selections must agree down to a field's
// arguments. That is why `markHabit` and `clearHabit` return the whole habit
// rather than the entry row, and why every document passes the same `$today`.

export const HabitPeriodFieldsFragment = graphql(`
  fragment HabitPeriodFields on HabitPeriod {
    start
    end
    done
    skipped
    target
    effectiveTarget
    met
  }
`);

export const HabitFieldsFragment = graphql(`
  fragment HabitFields on Habit {
    id
    name
    notes
    cue
    color
    period
    targetCount
    position
    archivedAt
    current(today: $today) {
      ...HabitPeriodFields
    }
    # An array of at most one, by the unique index on (habit, day), and the limit
    # says so: the server prices a list by its limit. The tally cannot say
    # whether today is done: "1 of 3" may have been Monday.
    todayEntry: entries(where: { day: { eq: $today } }, limit: 1) {
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
    partial
  }
`);

/**
 * What the detail screen adds: the periods the habit was counted over, and the
 * days inside them.
 *
 * Both bounds are literals in the document rather than variables, so there is
 * nothing for a caller to pass consistently and nothing to get wrong: the
 * mutation below selects the same fragment, and a field's arguments are part of
 * its cache key, so identical literals are what makes a mark land in the grid
 * that is already on screen. `HISTORY_DEFAULTS` holds the same two numbers for
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

/**
 * What the overview adds: the days marked inside the span it is drawing.
 *
 * The bounds are variables, unlike `HabitHistoryFields`, because the span moves
 * and a list of habits each holding 400 days costs more than a query may. The
 * overview's mutations take the same `$from` and `$to`, so a mark lands on the
 * key the query filled. No span is longer than a month, hence the limit.
 */
export const HabitOverviewFieldsFragment = graphql(`
  fragment HabitOverviewFields on Habit {
    id
    rangeEntries: entries(where: { day: { gte: $from, lt: $to } }, limit: 31) {
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

export const HabitsOverviewDocument = graphql(`
  query HabitsOverview($today: String!, $from: String!, $to: String!) {
    habits(
      where: { archivedAt: { isNull: true } }
      orderBy: { position: { direction: asc, priority: 1 }, createdAt: { direction: asc, priority: 2 } }
    ) {
      ...HabitFields
      ...HabitOverviewFields
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
      isAdmin
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

// Three shapes of the same two mutations, and the duplication is the point: the
// list screens hold no history, so asking for it on every tick would fetch a
// grid nothing is showing, and the detail screen holds one, so *not* asking
// would leave its squares a tick behind the tally above them. Each screen
// sends the version whose selection matches what it is displaying.

export const MarkHabitDocument = graphql(`
  mutation MarkHabit($habitId: ID!, $day: String!, $status: String, $note: String, $partial: Boolean, $today: String!) {
    markHabit(habitId: $habitId, day: $day, status: $status, note: $note, partial: $partial) {
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
  mutation MarkHabitDay($habitId: ID!, $day: String!, $status: String, $note: String, $partial: Boolean, $today: String!) {
    markHabit(habitId: $habitId, day: $day, status: $status, note: $note, partial: $partial) {
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

export const MarkHabitOverviewDocument = graphql(`
  mutation MarkHabitOverview(
    $habitId: ID!
    $day: String!
    $status: String
    $note: String
    $partial: Boolean
    $today: String!
    $from: String!
    $to: String!
  ) {
    markHabit(habitId: $habitId, day: $day, status: $status, note: $note, partial: $partial) {
      ...HabitFields
      ...HabitOverviewFields
    }
  }
`);

export const ClearHabitOverviewDocument = graphql(`
  mutation ClearHabitOverview($habitId: ID!, $day: String!, $today: String!, $from: String!, $to: String!) {
    clearHabit(habitId: $habitId, day: $day) {
      ...HabitFields
      ...HabitOverviewFields
    }
  }
`);

export const AuthConfigDocument = graphql(`
  query AuthConfig {
    authConfig {
      secureLocalNet
      magicLink
      sso {
        name
        signInUrl
      }
    }
  }
`);

// Signing in and out are better-auth's own endpoints, served as GraphQL by the server.
export const SignInMagicLinkDocument = graphql(`
  mutation SignInMagicLink($email: String!) {
    signInMagicLink(email: $email) {
      status
      token
      userId
    }
  }
`);

export const MagicLinkVerifyDocument = graphql(`
  mutation MagicLinkVerify($token: String!) {
    magicLinkVerify(token: $token) {
      token
    }
  }
`);

export const VerifyOneTimeTokenDocument = graphql(`
  mutation VerifyOneTimeToken($token: String!) {
    verifyOneTimeToken(token: $token) {
      token
      userId
    }
  }
`);

// The setup has no id to normalize by, so a pairing refetches it and `AuthConfig` by name.
export const SsoSetupFieldsFragment = graphql(`
  fragment SsoSetupFields on SsoSetup {
    source
    issuer
    name
    canPair
    redirectUri
  }
`);

export const SsoSetupDocument = graphql(`
  query SsoSetup {
    ssoSetup {
      ...SsoSetupFields
    }
  }
`);

export const PairSsoDocument = graphql(`
  mutation PairSso($setupUrl: String!) {
    pairSso(setupUrl: $setupUrl) {
      ...SsoSetupFields
    }
  }
`);

export const UnpairSsoDocument = graphql(`
  mutation UnpairSso {
    unpairSso {
      ...SsoSetupFields
    }
  }
`);

export const SignOutDocument = graphql(`
  mutation SignOut {
    signOut {
      success
    }
  }
`);
