/** The HTTP statuses this server sends by hand. */
export const HttpStatus = {
  Ok: 200,
  BadRequest: 400,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  ServiceUnavailable: 503,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
