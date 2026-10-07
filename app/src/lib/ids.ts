/**
 * A v4 UUID, generated here rather than by Postgres.
 *
 * A row's id has to exist before the row does: an optimistic list entry that
 * later swapped id would remount when the server answered. `crypto.randomUUID`
 * is restricted to secure contexts, and Ethos is meant to run on a LAN over
 * plain http. `crypto.getRandomValues` is not, so the fallback assembles a v4 by
 * hand rather than reaching for `Math.random`.
 */
const UUID_BYTES = 16;
const HEX = 16;
/** Where the dashes fall in the 32 hex digits of a UUID. */
const GROUP_ENDS = { first: 8, second: 12, third: 16, fourth: 20 } as const;

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTES));
  // Version 4, then variant 1: the RFC 4122 layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(HEX).padStart(2, '0')).join('');
  const { first, second, third, fourth } = GROUP_ENDS;
  return [
    hex.slice(0, first),
    hex.slice(first, second),
    hex.slice(second, third),
    hex.slice(third, fourth),
    hex.slice(fourth),
  ].join('-');
}
