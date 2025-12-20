/**
 * Tests for proxy utilities
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { parseProxyUrl, parseProxyFromEnv, resolveProxyConfig, formatProxyForCamoufox } from './proxy';
import type { ProxyConfig } from '../types';

describe('parseProxyUrl', () => {
  test('parses simple http proxy URL', () => {
    const result = parseProxyUrl('http://proxy.example.com:8080');
    expect(result).toEqual({
      server: 'http://proxy.example.com:8080',
      username: undefined,
      password: undefined,
    });
  });

  test('parses proxy URL with authentication', () => {
    const result = parseProxyUrl('http://user:pass@proxy.example.com:8080');
    expect(result).toEqual({
      server: 'http://proxy.example.com:8080',
      username: 'user',
      password: 'pass',
    });
  });

  test('parses https proxy URL with explicit port', () => {
    const result = parseProxyUrl('https://secure-proxy.com:8443');
    expect(result).toEqual({
      server: 'https://secure-proxy.com:8443',
      username: undefined,
      password: undefined,
    });
  });

  test('parses https proxy URL with default port', () => {
    // Default HTTPS port (443) is omitted by URL parser
    const result = parseProxyUrl('https://secure-proxy.com:443');
    expect(result.server).toBe('https://secure-proxy.com');
  });

  test('parses socks5 proxy URL', () => {
    const result = parseProxyUrl('socks5://localhost:1080');
    expect(result).toEqual({
      server: 'socks5://localhost:1080',
      username: undefined,
      password: undefined,
    });
  });

  test('handles URL-encoded credentials', () => {
    const result = parseProxyUrl('http://user%40domain:p%40ss%3Aword@proxy.com:8080');
    expect(result.server).toBe('http://proxy.com:8080');
    expect(result.username).toBe('user@domain');
    expect(result.password).toBe('p@ss:word');
  });

  test('handles host:port without protocol', () => {
    const result = parseProxyUrl('proxy.example.com:8080');
    expect(result.server).toBe('http://proxy.example.com:8080');
  });
});

describe('parseProxyFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear proxy-related env vars
    delete process.env.IMPI_PROXY_URL;
    delete process.env.PROXY_URL;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  test('returns undefined when no env var is set', () => {
    const result = parseProxyFromEnv();
    expect(result).toBeUndefined();
  });

  test('uses IMPI_PROXY_URL first', () => {
    process.env.IMPI_PROXY_URL = 'http://impi-proxy:8080';
    process.env.PROXY_URL = 'http://other-proxy:8080';
    process.env.HTTP_PROXY = 'http://http-proxy:8080';

    const result = parseProxyFromEnv();
    expect(result?.server).toBe('http://impi-proxy:8080');
  });

  test('falls back to PROXY_URL', () => {
    process.env.PROXY_URL = 'http://proxy-url:8080';
    process.env.HTTP_PROXY = 'http://http-proxy:8080';

    const result = parseProxyFromEnv();
    expect(result?.server).toBe('http://proxy-url:8080');
  });

  test('falls back to HTTP_PROXY', () => {
    process.env.HTTP_PROXY = 'http://http-proxy:8080';

    const result = parseProxyFromEnv();
    expect(result?.server).toBe('http://http-proxy:8080');
  });

  test('falls back to HTTPS_PROXY', () => {
    process.env.HTTPS_PROXY = 'https://https-proxy:8443';

    const result = parseProxyFromEnv();
    expect(result?.server).toBe('https://https-proxy:8443');
  });

  test('parses credentials from env var', () => {
    process.env.IMPI_PROXY_URL = 'http://user:pass@proxy:8080';

    const result = parseProxyFromEnv();
    expect(result?.username).toBe('user');
    expect(result?.password).toBe('pass');
  });
});

describe('resolveProxyConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.IMPI_PROXY_URL;
    delete process.env.PROXY_URL;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns options proxy when provided', () => {
    const optionsProxy: ProxyConfig = {
      server: 'http://options-proxy:8080',
      username: 'user',
      password: 'pass',
    };

    process.env.IMPI_PROXY_URL = 'http://env-proxy:8080';

    const result = resolveProxyConfig(optionsProxy);
    expect(result).toEqual(optionsProxy);
  });

  test('falls back to env when no options proxy', () => {
    process.env.IMPI_PROXY_URL = 'http://env-proxy:8080';

    const result = resolveProxyConfig(undefined);
    expect(result?.server).toBe('http://env-proxy:8080');
  });

  test('returns undefined when no proxy configured', () => {
    const result = resolveProxyConfig(undefined);
    expect(result).toBeUndefined();
  });
});

describe('formatProxyForCamoufox', () => {
  test('formats proxy with http:// prefix when missing', () => {
    const proxy: ProxyConfig = {
      server: 'gate-sg.ipfoxy.io:58688',
      username: 'user123',
      password: 'pass456',
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted).toBeDefined();
    expect(formatted.server).toBe('http://gate-sg.ipfoxy.io:58688');
    expect(formatted.username).toBe('user123');
    expect(formatted.password).toBe('pass456');
  });

  test('preserves existing http:// prefix', () => {
    const proxy: ProxyConfig = {
      server: 'http://gate-sg.ipfoxy.io:58688',
      username: 'user123',
      password: 'pass456',
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted).toBeDefined();
    expect(formatted.server).toBe('http://gate-sg.ipfoxy.io:58688');
    expect(formatted.username).toBe('user123');
    expect(formatted.password).toBe('pass456');
  });

  test('preserves https:// prefix', () => {
    const proxy: ProxyConfig = {
      server: 'https://gate-sg.ipfoxy.io:58688',
      username: 'user123',
      password: 'pass456',
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted).toBeDefined();
    expect(formatted.server).toBe('https://gate-sg.ipfoxy.io:58688');
  });

  test('handles proxy without credentials', () => {
    const proxy: ProxyConfig = {
      server: 'gate-sg.ipfoxy.io:58688',
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted).toBeDefined();
    expect(formatted.server).toBe('http://gate-sg.ipfoxy.io:58688');
    expect(formatted.username).toBeUndefined();
    expect(formatted.password).toBeUndefined();
  });

  test('returns undefined for undefined input', () => {
    const formatted = formatProxyForCamoufox(undefined);
    expect(formatted).toBeUndefined();
  });
});
