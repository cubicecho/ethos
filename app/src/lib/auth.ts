import { Platform } from 'react-native';

// The session token lives in localStorage rather than a cookie: the API is a
// Bearer-token GraphQL endpoint with no session table, and the client is a
// static bundle that may be served from a different origin in development.
const TOKEN_KEY = 'ethos_token';

/**
 * Reads the session token.
 *
 * @returns The token, or null when signed out or off the web.
 */
export function getToken(): string | null {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

/**
 * Stores the session token.
 *
 * @param token - The JWT the server issued.
 */
export function setToken(token: string): void {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

/** Forgets the session token, which signs the user out. */
export function clearToken(): void {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Whether a session token is stored.
 *
 * @returns true when there is one; it may still have expired.
 */
export function isAuthenticated(): boolean {
  return getToken() !== null;
}
