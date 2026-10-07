import { GraphQLError } from 'graphql';

/** The `extensions.code` values clients branch on. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const withCode =
  (code: ErrorCode) =>
  (message: string): GraphQLError =>
    new GraphQLError(message, { extensions: { code } });

/** Arguments the caller can fix. */
export const badInput = withCode(ErrorCode.BadUserInput);
/** Missing, or someone else's. Deliberately one code. */
export const notFound = withCode(ErrorCode.NotFound);
/** Nobody is signed in, or the session has run out. */
export const unauthenticated = withCode(ErrorCode.Unauthenticated);
/** Too many attempts for now. */
export const rateLimited = withCode(ErrorCode.TooManyRequests);

/** What went wrong, as a sentence: an `Error`'s message, or the thrown value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
