import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/**
 * A key another program calls Ethos with, as `x-api-key`. Owned by better-auth's api-key plugin,
 * whose column set this is: only the key's hash is kept, and deleting the row revokes it.
 */
export const apikeys = pgTable(
  'apikeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    /** The key's first characters, kept in the clear so a list can tell keys apart. */
    start: text('start'),
    prefix: text('prefix'),
    /** The key's hash. The key itself exists only in the answer to the request that made it. */
    key: text('key').notNull(),
    /** The plugin's word for the owner: a user id. */
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    permissions: text('permissions'),
    /** JSON, serialized by the plugin. */
    metadata: text('metadata'),
  },
  (table) => [index('idx_apikeys_reference_id').on(table.referenceId), index('idx_apikeys_key').on(table.key)],
);

export type ApiKey = typeof apikeys.$inferSelect;
export type NewApiKey = typeof apikeys.$inferInsert;
