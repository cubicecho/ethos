import type { z } from 'zod';
import { badInput } from './errors.ts';

/** What the caller reads when a schema refuses a value and says nothing of its own. */
const INVALID = 'That input is not valid.';

/**
 * Parses `value` with `schema`, or throws `BAD_USER_INPUT` with the first thing wrong.
 *
 * One issue, not all of them: the message goes to a person, who fixes one
 * field at a time.
 *
 * @typeParam Output - What the schema produces.
 * @param schema - The zod schema that says what is acceptable.
 * @param value - Whatever arrived.
 * @returns The parsed value.
 */
export function parseOrThrow<Output>(schema: z.ZodType<Output>, value: unknown): Output {
  const result = schema.safeParse(value);
  if (result.success === false) {
    throw badInput(result.error.issues[0]?.message ?? INVALID);
  }
  return result.data;
}
