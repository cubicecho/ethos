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
 * credentials puts the userinfo where a prefix match looks for the host.
 * "Local" is wider than loopback, because self-hosting is: a compose service or
 * a box on the LAN speaks no TLS by default, and demanding it breaks the
 * connection. Only an address that could route off a private network gets it.
 */
export function requiresSsl(url: string): boolean {
  // An explicit sslmode is the operator's decision; postgres-js reads it itself.
  if (/[?&]sslmode=/i.test(url)) return false;

  const hostname = hostnameOf(url);
  if (hostname === null) return false;

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  // A name with no dots is a container or LAN hostname, not a public address.
  if (!hostname.includes('.') && !hostname.includes(':')) return false;
  // Nor is a name under a private-use suffix: the router or mDNS resolves it,
  // and the dot in it says nothing about reach.
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [firstOctet, secondOctet] = ipv4.slice(1).map(Number);
    // Loopback, the three RFC 1918 ranges, then link-local.
    if (firstOctet === 127) return false;
    if (firstOctet === 10) return false;
    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return false;
    if (firstOctet === 192 && secondOctet === 168) return false;
    if (firstOctet === 169 && secondOctet === 254) return false;
    return true;
  }

  if (hostname.includes(':')) {
    // Loopback, unique-local fc00::/7, then link-local fe80::/10.
    if (hostname === '::1') return false;
    if (/^f[cd]/.test(hostname)) return false;
    if (/^fe[89ab]/.test(hostname)) return false;
    return true;
  }

  return true;
}
