import { GraphQLError } from 'graphql';
import { HttpStatus } from './wire.ts';

/** The `extensions.code` values clients branch on. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
  QueryTooComplex: 'QUERY_TOO_COMPLEX',
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
/** Too many attempts for now. `retryAfter` is the seconds until the next one would be let through. */
export function rateLimited(message: string, retryAfter: number): GraphQLError {
  return new GraphQLError(message, { extensions: { code: ErrorCode.TooManyRequests, retryAfter } });
}

/**
 * The operation asks for more than one request may: too deep, too many aliases
 * or too costly. Refused before it runs, so it is a 400 and not a result.
 */
export function tooComplex(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: ErrorCode.QueryTooComplex, http: { status: HttpStatus.BadRequest } },
  });
}

/** What went wrong, as a sentence: an `Error`'s message, or the thrown value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
