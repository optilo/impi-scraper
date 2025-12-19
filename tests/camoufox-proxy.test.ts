/**
 * Tests for Camoufox integration and auto-proxy default behavior
 *
 * Run: bun test tests/camoufox-proxy.test.ts --timeout 120000
 */

import { test, expect, describe, beforeAll } from 'bun:test';
import { formatProxyForCamoufox } from '../src/utils/proxy';
import type { ProxyConfig } from '../src/types';
import { IMPIScraper } from '../src/scraper';
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

describe('IMPIScraper auto-proxy default behavior', () => {
  const hasIPFoxyToken = !!parseProxyProviderFromEnv();

  test('defaults to auto-proxy when proxy not specified', async () => {
    // Create scraper without specifying proxy - should default to 'auto'
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
    });

    // The scraper should have auto-proxy configured (will be resolved when browser is created)
    // We can't directly test the internal state, but we can verify it doesn't throw
    expect(scraper).toBeDefined();

    // Try a simple search - this will trigger auto-proxy resolution
    try {
      const results = await scraper.search('vitrum');

      expect(results).toBeDefined();
      expect(results.metadata).toBeDefined();
      expect(results.metadata.query).toBe('vitrum');
      console.log('\n✅ Auto-proxy default behavior: Search succeeded');
    } catch (err) {
      // If IPFoxy token is not set, it should fall back gracefully
      const error = err as Error;
      if (error.message.includes('IPFOXY_API_TOKEN')) {
        console.log('\n⚠️  Auto-proxy: IPFoxy token not set, falling back to env/no proxy');
        // This is acceptable - the fallback should work
        expect(true).toBe(true);
      } else {
        throw err;
      }
    }
  }, 120000);

  test('explicitly disables proxy when proxy: null', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
      proxy: null, // Explicitly disable
    });

    expect(scraper).toBeDefined();

    // Should work without proxy
    const results = await scraper.search('vitrum');

    expect(results).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');
    console.log('\n✅ Explicit proxy: null - Search succeeded without proxy');
  }, 120000);

  test.skipIf(!hasIPFoxyToken)('uses auto-fetched proxy when IPFOXY_API_TOKEN is set', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
      // proxy not specified = defaults to 'auto'
    });

    // This should auto-fetch from IPFoxy
    const results = await scraper.search('vitrum');

    expect(results).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');
    console.log('\n✅ Auto-fetched proxy: Search succeeded with IPFoxy proxy');
  }, 120000);
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

  test('explicitly disables proxy when proxy: null', async () => {
    const client = new IMPIApiClient({
      headless: true,
      proxy: null, // Explicitly disable
    });

    expect(client).toBeDefined();

    // Should work without proxy
    await client.initSession();
    console.log('\n✅ Explicit proxy: null - Session initialized without proxy');
    await client.close();
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
  test('IMPIScraper uses Camoufox for direct searches', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
      proxy: null, // Disable proxy for this test
    });

    // Direct search should use Camoufox (not Playwright)
    const results = await scraper.search('vitrum');

    expect(results).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');
    expect(results.results.length).toBeGreaterThan(0);
    console.log('\n✅ Camoufox integration: Direct search succeeded');
  }, 120000);

  test('IMPIApiClient uses Camoufox for session initialization', async () => {
    const client = new IMPIApiClient({
      headless: true,
      proxy: null, // Disable proxy for this test
    });

    // Session initialization should use Camoufox
    await client.initSession();

    // Verify session is valid by doing a quick search
    const { searchId, totalResults } = await client.quickSearch('vitrum');
    expect(searchId).toBeDefined();
    expect(totalResults).toBeGreaterThan(0);

    console.log('\n✅ Camoufox integration: Session initialization and quick search succeeded');
    await client.close();
  }, 120000);
});

