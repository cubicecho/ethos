import { describe, expect, it } from 'vitest';
import { requiresSsl } from '../ssl.ts';

/**
 * The cost of getting this wrong is a container that crash-loops: demanding TLS
 * from a plaintext Postgres does not degrade, it resets the connection. So the
 * question is always "could this address route off a private network", and every
 * shape of address that cannot has a case here.
 */
describe('requiresSsl', () => {
  it('leaves the decision alone when the connection string states one', () => {
    expect(requiresSsl('postgres://u:p@db.example.com:5432/ethos?sslmode=require')).toBe(false);
    expect(requiresSsl('postgres://u:p@db.example.com:5432/ethos?x=1&sslmode=disable')).toBe(false);
  });

  it('reads the host out of the URL rather than the string', () => {
    // The userinfo sits exactly where a naive prefix match looks for the host.
    expect(requiresSsl('postgres://postgres:localhost@db.example.com:5432/ethos')).toBe(true);
  });

  it('does not force TLS on loopback', () => {
    expect(requiresSsl('postgres://ethos:ethos@localhost:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@127.0.0.1:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@[::1]:5438/ethos')).toBe(false);
  });

  it('does not force TLS on a compose service name', () => {
    expect(requiresSsl('postgres://ethos:ethos@postgres:5432/ethos')).toBe(false);
  });

  it('does not force TLS on private address space', () => {
    expect(requiresSsl('postgres://ethos:ethos@10.0.0.175:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@172.16.4.2:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@192.168.1.10:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@[fd00::1]:5438/ethos')).toBe(false);
  });

  it('does not force TLS on a private-use domain suffix', () => {
    // The ordinary remote-daemon setup: `docker context ls` says ssh://docker.lan
    // and the database is published there. A dot in the name is not reach.
    expect(requiresSsl('postgres://ethos:ethos@docker.lan:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@nas.local:5438/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@db.internal:5432/ethos')).toBe(false);
    expect(requiresSsl('postgres://ethos:ethos@pi.home.arpa:5432/ethos')).toBe(false);
  });

  it('forces TLS on anything that could leave the network', () => {
    expect(requiresSsl('postgres://u:p@db.example.com:5432/ethos')).toBe(true);
    expect(requiresSsl('postgres://u:p@203.0.113.9:5432/ethos')).toBe(true);
    expect(requiresSsl('postgres://u:p@[2001:db8::1]:5432/ethos')).toBe(true);
  });

  it('says no rather than throwing on a string that is not a URL', () => {
    expect(requiresSsl('not a url')).toBe(false);
  });
});
