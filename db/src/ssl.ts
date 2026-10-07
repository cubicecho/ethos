/**
 * Domain suffixes reserved for, or conventionally used on, private networks.
 * `.local` is mDNS, `.home.arpa` is the RFC 8375 name for a home network, and
 * the rest are what routers and Docker hosts are actually called.
 */
const PRIVATE_SUFFIXES = [
  '.lan',
  '.local',
  '.localdomain',
  '.home',
  '.home.arpa',
  '.internal',
  '.intranet',
  '.private',
];

/** The URL's hostname, lowercased and without IPv6 brackets, or null when the URL does not parse. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether to insist on TLS for a connection string.
 *
 * Read from the parsed hostname, never the raw string: a URL carrying
 * credentials (`postgres://user:pass@postgres:5432/db`) puts the userinfo where
 * a naive prefix match looks for the host.
 *
 * "Local" is wider than loopback here, because self-hosting is. A bare
 * `postgres` is a service on a compose network; `10.0.0.5` is a box on the
 * LAN — neither speaks TLS by default, and demanding it just breaks the
 * connection. Only an address that could route off a private network gets TLS
 * forced on it.
 */
export function requiresSsl(url: string): boolean {
  // An explicit sslmode is the operator's decision; postgres-js reads it itself.
  if (/[?&]sslmode=/i.test(url)) return false;

  const hostname = hostnameOf(url);
  if (hostname === null) return false;

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  // A name with no dots is a container or LAN hostname, not a public address.
  if (!hostname.includes('.') && !hostname.includes(':')) return false;
  // Nor is a name under a private-use suffix. `docker.lan`, `nas.local` and
  // `db.internal` are resolved by the router or by mDNS and cannot route off the
  // network you are standing on — the dot in them says nothing about reach, and
  // the Postgres behind one is as plaintext as the container next door.
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [firstOctet, secondOctet] = ipv4.slice(1).map(Number);
    if (firstOctet === 127) return false; // loopback
    if (firstOctet === 10) return false; // 10/8
    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return false; // 172.16/12
    if (firstOctet === 192 && secondOctet === 168) return false; // 192.168/16
    if (firstOctet === 169 && secondOctet === 254) return false; // link-local
    return true;
  }

  if (hostname.includes(':')) {
    if (hostname === '::1') return false; // loopback
    if (/^f[cd]/.test(hostname)) return false; // unique-local fc00::/7
    if (/^fe[89ab]/.test(hostname)) return false; // link-local fe80::/10
    return true;
  }

  return true;
}
