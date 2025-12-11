/**
 * Integration tests for proxy support and external IP detection
 *
 * Run with: bun test tests/proxy.integration.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { searchTrademarks, IMPIScraper } from '../src/index';

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
