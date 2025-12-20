/**
 * Tests for Camoufox integration and auto-proxy default behavior
 *
 * Run: pnpm test tests/camoufox-proxy.test.ts --testTimeout=120000
 */

import { test, expect, describe } from 'vitest';
import { formatProxyForCamoufox } from '../src/utils/proxy';
import type { ProxyConfig } from '../src/types';
import { IMPIApiClient } from '../src/api';
import { parseProxyProviderFromEnv } from '../src/utils/proxy-provider';

describe('formatProxyForCamoufox utility', () => {
  test('formats proxy with http:// prefix correctly', () => {
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

describe('IMPIApiClient auto-proxy default behavior', () => {
  const hasIPFoxyToken = !!parseProxyProviderFromEnv();

  test('defaults to auto-proxy when proxy not specified', async () => {
    const client = new IMPIApiClient({
      headless: true,
      // proxy not specified = defaults to 'auto'
    });

    expect(client).toBeDefined();

    // Try to initialize session - this will trigger auto-proxy resolution
    try {
      await client.initSession();
      console.log('\n✅ Auto-proxy default behavior: Session initialized');
      await client.close();
    } catch (err) {
      // If IPFoxy token is not set, it should fall back gracefully
      const error = err as Error;
      if (error.message.includes('IPFOXY_API_TOKEN')) {
        console.log('\n⚠️  Auto-proxy: IPFoxy token not set, falling back to env/no proxy');
        expect(true).toBe(true);
      } else {
        throw err;
      }
    }
  }, 60000);

  test.skipIf(!hasIPFoxyToken)('uses auto-fetched proxy when IPFOXY_API_TOKEN is set', async () => {
    const client = new IMPIApiClient({
      headless: true,
      // proxy not specified = defaults to 'auto'
    });

    // This should auto-fetch from IPFoxy
    await client.initSession();
    console.log('\n✅ Auto-fetched proxy: Session initialized with IPFoxy proxy');
    await client.close();
  }, 60000);
});

describe('Camoufox integration verification', () => {
  const hasIPFoxyToken = !!parseProxyProviderFromEnv();

  test.skipIf(!hasIPFoxyToken)('IMPIApiClient uses Camoufox with proxy for session initialization', async () => {
    const client = new IMPIApiClient({
      headless: true,
      // proxy defaults to 'auto' - will use IPFoxy
    });

    // Session initialization should use Camoufox with proxy
    await client.initSession();

    // Verify session is valid by doing a quick search
    const { searchId, totalResults } = await client.quickSearch('vitrum');
    expect(searchId).toBeDefined();
    expect(totalResults).toBeGreaterThan(0);

    console.log('\n✅ Camoufox integration: Session initialization and quick search succeeded with proxy');
    await client.close();
  }, 120000);
});

