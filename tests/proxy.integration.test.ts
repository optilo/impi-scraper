/**
 * Integration tests for proxy support, external IP detection, and IPFoxy provider
 *
 * Run with: pnpm test:proxy
 */

import { describe, test, expect } from 'vitest';
import { searchTrademarks, IMPIScraper, testProxy, fetchProxiesFromEnv, parseProxyProviderFromEnv } from '../src/index';

describe('External IP Detection', () => {
  test('returns external IP in search metadata', async () => {
    const results = await searchTrademarks('vitrum', {
      headless: true,
      humanBehavior: false,
      maxResults: 1,
      detailLevel: 'basic',
    });

    // Verify metadata structure
    expect(results.metadata).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');
    expect('externalIp' in results.metadata).toBe(true);

    // If IP was detected, log it
    if (results.metadata.externalIp) {
      console.log(`\n📍 External IP: ${results.metadata.externalIp}`);
    }

    console.log(`\n📊 Search completed: ${results.results.length} results in ${results.performance.durationMs}ms`);
  }, 120000);
});

describe('Proxy Configuration', () => {
  test('accepts proxy in options', () => {
    const scraper = new IMPIScraper({
      proxy: {
        server: 'http://test-proxy:8080',
        username: 'user',
        password: 'pass',
      },
    });
    expect(scraper).toBeDefined();
  });

  test('works without proxy config', () => {
    const scraper = new IMPIScraper({ headless: true });
    expect(scraper).toBeDefined();
  });

  // Only run if proxy env var is set
  const hasProxy = !!process.env.IMPI_PROXY_URL;

  test.skipIf(!hasProxy)('uses proxy from IMPI_PROXY_URL env var', async () => {
    const results = await searchTrademarks('test', {
      headless: true,
      humanBehavior: false,
      maxResults: 1,
    });

    expect(results.metadata.externalIp).toBeDefined();
    console.log(`\n📍 Proxy IP: ${results.metadata.externalIp}`);
  }, 120000);
});

describe('IPFoxy Proxy Provider', () => {
  const hasIPFoxyToken = !!parseProxyProviderFromEnv();

  // Helper to avoid rate limiting between tests
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  test.skipIf(!hasIPFoxyToken)('fetches single proxy from IPFoxy API', async () => {
    const result = await fetchProxiesFromEnv(1);

    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.provider).toBe('ipfoxy');
    expect(result!.proxies).toHaveLength(1);

    const proxy = result!.proxies[0]!;
    expect(proxy.server).toContain('ipfoxy.io');
    expect(proxy.username).toBeDefined();
    expect(proxy.password).toBeDefined();

    console.log(`\n✅ Fetched proxy: ${proxy.server}`);
    console.log(`   Username: ${proxy.username}`);
  });

  test.skipIf(!hasIPFoxyToken)('fetches multiple proxies with unique session IDs', async () => {
    await delay(2000); // Wait to avoid rate limiting
    const result = await fetchProxiesFromEnv(3);

    expect(result).not.toBeNull();
    expect(result!.count).toBe(3);
    expect(result!.proxies).toHaveLength(3);

    // Each proxy should have a unique session ID (different suffix)
    const usernames = result!.proxies.map(p => p.username);
    const uniqueUsernames = new Set(usernames);
    expect(uniqueUsernames.size).toBe(3);

    // Session IDs should follow pattern: ..._10000, ..._10001, ..._10002
    expect(usernames[0]).toMatch(/_\d+$/);
    expect(usernames[1]).toMatch(/_\d+$/);
    expect(usernames[2]).toMatch(/_\d+$/);

    console.log(`\n✅ Fetched 3 proxies with unique session IDs:`);
    usernames.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
  });

  test.skipIf(!hasIPFoxyToken)('proxy connects and returns external IP', async () => {
    await delay(2000); // Wait to avoid rate limiting
    const result = await fetchProxiesFromEnv(1);
    expect(result).not.toBeNull();

    const proxy = result!.proxies[0]!;
    console.log(`\nTesting proxy connectivity: ${proxy.server}`);

    const externalIp = await testProxy(proxy);

    expect(externalIp).toBeDefined();
    expect(externalIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/); // IPv4 format
    console.log(`✅ Proxy working! External IP: ${externalIp}`);
  }, 60000); // 60s timeout for browser operations
});
