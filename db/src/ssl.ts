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

/**
 * IPv4 blocks that never route off a private network, by first octet and the
 * span of second octets: loopback, the three RFC 1918 ranges, then link-local.
 */
const PRIVATE_IPV4: readonly { first: number; low: number; high: number }[] = [
  { first: 127, low: 0, high: 255 },
  { first: 10, low: 0, high: 255 },
  { first: 172, low: 16, high: 31 },
  { first: 192, low: 168, high: 168 },
  { first: 169, low: 254, high: 254 },
];

/**
 * The URL's hostname, lowercased and without IPv6 brackets, or null when the URL does not parse.
 *
 * @param url - The connection string.
 * @returns The hostname, or null.
 */
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
 * credentials puts the userinfo where a prefix match looks for the host.
 * "Local" is wider than loopback, because self-hosting is: a compose service or
 * a box on the LAN speaks no TLS by default, and demanding it breaks the
 * connection. Only an address that could route off a private network gets it.
 *
 * @param url - The connection string.
 * @returns false for a local host, and when the URL sets its own `sslmode`.
 */
export function requiresSsl(url: string): boolean {
  // An explicit sslmode is the operator's decision; postgres-js reads it itself.
  if (/[?&]sslmode=/i.test(url)) {
    return false;
  }

  const hostname = hostnameOf(url);
  if (hostname === null) {
    return false;
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return false;
  }
  // A name with no dots is a container or LAN hostname, not a public address.
  if (hostname.includes('.') === false && hostname.includes(':') === false) {
    return false;
  }
  // Nor is a name under a private-use suffix: the router or mDNS resolves it,
  // and the dot in it says nothing about reach.
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return false;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [firstOctet, secondOctet] = ipv4.slice(1).map(Number);
    return (
      PRIVATE_IPV4.some(
        (range) => range.first === firstOctet && secondOctet >= range.low && secondOctet <= range.high,
      ) === false
    );
  }

  if (hostname.includes(':')) {
    // Loopback, unique-local fc00::/7, then link-local fe80::/10.
    if (hostname === '::1') {
      return false;
    }
    if (/^f[cd]/.test(hostname)) {
      return false;
    }
    if (/^fe[89ab]/.test(hostname)) {
      return false;
    }
    return true;
  }

  return true;
}
