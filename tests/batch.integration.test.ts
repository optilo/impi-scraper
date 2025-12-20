/**
 * Integration tests for batch search
 *
 * Run with: pnpm test:integration tests/batch.integration.test.ts --testTimeout=180000
 *
 * Tests batch search functionality with:
 * - Multiple results with pagination (tiptop: ~14 results)
 * - Few results without pagination (bonvi: ~2 results)
 * - Zero results (77bet: 0 results)
 */

import { describe, test, expect } from 'vitest';
import { IMPIScraper } from '../src/index';

// Test keywords from production database
const TEST_KEYWORDS = {
  pagination: 'tiptop',    // ~14 results (requires pagination handling)
  fewResults: 'bonvi',     // ~2 results (single page)
  noResults: '77bet',      // 0 results
};

describe('Batch Search Integration', () => {
  test('processes multiple keywords with single browser session', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
      humanBehavior: true,
      rateLimitMs: 2000,
    });

    const keywords = [
      TEST_KEYWORDS.pagination,
      TEST_KEYWORDS.fewResults,
      TEST_KEYWORDS.noResults,
    ];

    const callbackResults: Array<{
      keyword: string;
      count: number | null;
      error?: string;
    }> = [];

    console.log(`\n🚀 Starting batch search for ${keywords.length} keywords...`);
    console.log(`   Keywords: ${keywords.join(', ')}\n`);

    const batchResult = await scraper.searchBatch(keywords, async (keyword, result, error) => {
      if (error) {
        console.log(`   ❌ ${keyword}: ${error.message}`);
        callbackResults.push({ keyword, count: null, error: error.message });
      } else {
        const count = result!.results.length;
        console.log(`   ✓ ${keyword}: ${count} result(s)`);
        callbackResults.push({ keyword, count });
      }
    });

    // ===== BATCH RESULT VALIDATION =====
    console.log(`\n📊 Batch Summary:`);
    console.log(`   Successful: ${batchResult.successful}`);
    console.log(`   Failed: ${batchResult.failed}`);

    // Should have processed all keywords
    expect(batchResult.successful + batchResult.failed).toBe(keywords.length);

    // All should be successful (no blocking expected)
    expect(batchResult.successful).toBe(3);
    expect(batchResult.failed).toBe(0);

    // ===== CALLBACK VALIDATION =====
    expect(callbackResults.length).toBe(3);

    // ===== PAGINATION KEYWORD VALIDATION =====
    const paginationResult = batchResult.results.get(TEST_KEYWORDS.pagination);
    expect(paginationResult).toBeDefined();
    expect(paginationResult!.results.length).toBeGreaterThan(5);
    console.log(`\n📋 ${TEST_KEYWORDS.pagination}: ${paginationResult!.results.length} results (expected many)`);

    // Verify metadata
    expect(paginationResult!.metadata.query).toBe(TEST_KEYWORDS.pagination);
    expect(paginationResult!.metadata.searchId).toBeDefined();
    expect(paginationResult!.metadata.totalResults).toBeGreaterThan(0);

    // Verify result structure
    const firstResult = paginationResult!.results[0]!;
    expect(firstResult.impiId).toBeDefined();
    expect(firstResult.title.toLowerCase()).toContain(TEST_KEYWORDS.pagination.toLowerCase());
    expect(firstResult.status).toBeDefined();

    // ===== FEW RESULTS KEYWORD VALIDATION =====
    const fewResult = batchResult.results.get(TEST_KEYWORDS.fewResults);
    expect(fewResult).toBeDefined();
    expect(fewResult!.results.length).toBeGreaterThan(0);
    expect(fewResult!.results.length).toBeLessThanOrEqual(5);
    console.log(`📋 ${TEST_KEYWORDS.fewResults}: ${fewResult!.results.length} results (expected 1-5)`);

    // ===== ZERO RESULTS KEYWORD VALIDATION =====
    const noResult = batchResult.results.get(TEST_KEYWORDS.noResults);
    expect(noResult).toBeDefined();
    expect(noResult!.results.length).toBe(0);
    expect(noResult!.metadata.totalResults).toBe(0);
    console.log(`📋 ${TEST_KEYWORDS.noResults}: ${noResult!.results.length} results (expected 0)`);

    // ===== VERIFY SINGLE BROWSER SESSION =====
    // All results should have been processed - if browser crashed it would have fewer
    expect(batchResult.results.size).toBe(3);

    console.log(`\n✅ Batch test completed successfully!`);
  }, 180000);

  test('handles empty keyword array gracefully', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
    });

    const batchResult = await scraper.searchBatch([]);

    expect(batchResult.successful).toBe(0);
    expect(batchResult.failed).toBe(0);
    expect(batchResult.results.size).toBe(0);
    expect(batchResult.errors.size).toBe(0);
  }, 10000);

  test('single keyword batch works correctly', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'basic',
      humanBehavior: true,
      rateLimitMs: 1500,
    });

    let callbackCalled = false;

    const batchResult = await scraper.searchBatch([TEST_KEYWORDS.fewResults], async (keyword, result, error) => {
      callbackCalled = true;
      expect(keyword).toBe(TEST_KEYWORDS.fewResults);
      expect(error).toBeUndefined();
      expect(result).toBeDefined();
    });

    expect(callbackCalled).toBe(true);
    expect(batchResult.successful).toBe(1);
    expect(batchResult.failed).toBe(0);

    const result = batchResult.results.get(TEST_KEYWORDS.fewResults);
    expect(result).toBeDefined();
    expect(result!.results.length).toBeGreaterThan(0);

    console.log(`\n✅ Single keyword batch: ${result!.results.length} results`);
  }, 60000);
});
