/**
 * Unit tests for IMPIScraper
 */

import { describe, test, expect } from 'bun:test';
import { IMPIScraper, searchTrademarks } from './index';

describe('IMPIScraper', () => {
  describe('constructor', () => {
    test('uses default options', () => {
      const scraper = new IMPIScraper();
      expect(scraper).toBeDefined();
    });

    test('accepts custom options', () => {
      const scraper = new IMPIScraper({
        headless: false,
        rateLimitMs: 3000,
        detailLevel: 'full'
      });
      expect(scraper).toBeDefined();
    });

    test('accepts all option combinations', () => {
      const scraper = new IMPIScraper({
        headless: true,
        rateLimitMs: 1000,
        maxConcurrency: 2,
        maxRetries: 5,
        humanBehavior: false,
        detailLevel: 'basic'
      });
      expect(scraper).toBeDefined();
    });
  });
});

describe('searchTrademarks API', () => {
  test('function exists and is callable', () => {
    expect(typeof searchTrademarks).toBe('function');
  });
});
