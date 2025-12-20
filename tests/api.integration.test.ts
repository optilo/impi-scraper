/**
 * Integration tests for API-only mode
 *
 * Run with: pnpm test:integration --testTimeout=180000
 *
 * Tests the direct API approach:
 * 1. Boot browser once to get session tokens
 * 2. Hit IMPI's internal API directly via fetch
 * 3. Much faster than full browser scraping
 */

import { describe, test, expect, afterAll } from 'vitest';
import { IMPIApiClient } from '../src/api';

// ISO date format regex
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
const IMPI_ID_REGEX = /^[A-Z]{2}\d{4}\d+$/;
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

describe('API-Only Mode Integration', () => {
  let client: IMPIApiClient;

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  test('initializes session and extracts tokens', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      apiRateLimitMs: 500,
    });

    // Should extract session tokens from browser
    await client.initSession();

    // Session should be valid (we can't check internal state, but no error = success)
    expect(true).toBe(true);
    console.log(`\n✅ Session initialized successfully`);
  }, 60000);

  test('performs quick search for "hazlo" and gets searchId', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      apiRateLimitMs: 500,
    });

    const { searchId, totalResults } = await client.quickSearch('hazlo');

    // Should get valid searchId
    expect(searchId).toBeDefined();
    expect(searchId).toMatch(UUID_REGEX);

    // Should have results
    expect(totalResults).toBeGreaterThan(0);

    console.log(`\n📊 Quick Search Result for "hazlo":`);
    console.log(`   Search ID: ${searchId}`);
    console.log(`   Total Results: ${totalResults}`);
  }, 60000);

  test('fetches paginated results via direct API for "hazlo"', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      apiRateLimitMs: 500,
    });

    // First get searchId
    const { searchId, totalResults } = await client.quickSearch('hazlo');
    expect(searchId).toBeDefined();

    // Calculate pages needed
    const pageSize = 100;
    const totalPages = Math.ceil(totalResults / pageSize);

    console.log(`\n📊 Pagination Test for "hazlo":`);
    console.log(`   Total Results: ${totalResults}`);
    console.log(`   Page Size: ${pageSize}`);
    console.log(`   Total Pages: ${totalPages}`);

    // Fetch first page via API
    const page0 = await client.getSearchResults(searchId, 0, pageSize);
    expect(page0).toBeDefined();
    expect(page0.resultPage).toBeInstanceOf(Array);
    expect(page0.resultPage.length).toBeGreaterThan(0);

    console.log(`   Page 0: ${page0.resultPage.length} results`);

    // If there are multiple pages, fetch page 1 too
    if (totalPages > 1) {
      const page1 = await client.getSearchResults(searchId, 1, pageSize);
      expect(page1.resultPage).toBeInstanceOf(Array);
      console.log(`   Page 1: ${page1.resultPage.length} results`);
    }

    // Validate first result structure
    const first = page0.resultPage[0]!;
    expect(first.id).toMatch(IMPI_ID_REGEX);
    expect(first.title).toBeDefined();
    expect(first.status).toBeDefined();

    console.log(`\n   Sample Result:`);
    console.log(`   - ID: ${first.id}`);
    console.log(`   - Title: ${first.title}`);
    console.log(`   - Status: ${first.status}`);
  }, 90000);

  test('BASIC mode: full search via API returns complete results', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      detailLevel: 'basic',
      apiRateLimitMs: 400,
      maxResults: 15, // Test pagination
    });

    const startTime = Date.now();
    const results = await client.search('hazlo');
    const duration = Date.now() - startTime;

    // Validate metadata
    expect(results.metadata).toBeDefined();
    expect(results.metadata.query).toBe('hazlo');
    expect(results.metadata.executedAt).toMatch(ISO_DATETIME_REGEX);
    expect(results.metadata.searchId).toMatch(UUID_REGEX);
    expect(results.metadata.totalResults).toBeGreaterThan(0);

    // Validate results
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.results.length).toBeLessThanOrEqual(15);

    // Validate first result
    const first = results.results[0]!;
    expect(first.impiId).toMatch(IMPI_ID_REGEX);
    expect(first.status).toBeDefined();
    expect(first.detailsUrl).toContain('marcia.impi.gob.mx');

    // Count statuses
    const statusCounts = results.results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  📊 BASIC MODE SUMMARY - "hazlo"                       ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Total in IMPI:     ${(results.metadata.totalResults ?? 0).toString().padEnd(36)}║`);
    console.log(`║  Processed:         ${results.results.length.toString().padEnd(36)}║`);
    console.log(`║  Duration:          ${(duration / 1000).toFixed(2).padEnd(33)}s ║`);
    console.log(`║  Avg per result:    ${results.performance.avgPerResultMs.toString().padEnd(33)}ms ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Status Distribution:                                  ║`);
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`║    - ${status.padEnd(20)} ${count.toString().padEnd(28)}║`);
    });
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Sample Trademarks:                                    ║`);
    results.results.slice(0, 3).forEach((r, i) => {
      console.log(`║  ${i + 1}. ${r.title.substring(0, 50).padEnd(53)}║`);
      console.log(`║     ID: ${r.impiId.padEnd(47)}║`);
    });
    console.log(`╚════════════════════════════════════════════════════════╝`);
  }, 90000);

  test('FULL mode: fetches complete details including owners and history', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      detailLevel: 'full',
      apiRateLimitMs: 500,
      maxResults: 3, // Limit for faster test
    });

    const startTime = Date.now();
    const results = await client.search('hazlo');
    const duration = Date.now() - startTime;

    // Validate results have full details
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBeGreaterThan(0);

    // Check for detailed fields
    const first = results.results[0]!;
    expect(first.impiId).toMatch(IMPI_ID_REGEX);

    // Full mode should have owners array
    expect(first.owners).toBeInstanceOf(Array);

    // Full mode should have classes array
    expect(first.classes).toBeInstanceOf(Array);

    // Count results with owners
    const withOwners = results.results.filter(r => r.owners && r.owners.length > 0).length;
    const withClasses = results.results.filter(r => r.classes && r.classes.length > 0).length;
    const withHistory = results.results.filter(r => r.history && r.history.length > 0).length;

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  📊 FULL MODE SUMMARY - "hazlo"                        ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Total in IMPI:     ${(results.metadata.totalResults ?? 0).toString().padEnd(36)}║`);
    console.log(`║  Processed:         ${results.results.length.toString().padEnd(36)}║`);
    console.log(`║  Duration:          ${(duration / 1000).toFixed(2).padEnd(33)}s ║`);
    console.log(`║  Avg per result:    ${results.performance.avgPerResultMs.toString().padEnd(33)}ms ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Detail Coverage:                                      ║`);
    console.log(`║    - With Owners:   ${withOwners.toString().padEnd(36)}║`);
    console.log(`║    - With Classes:  ${withClasses.toString().padEnd(36)}║`);
    console.log(`║    - With History:  ${withHistory.toString().padEnd(36)}║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Detailed Results:                                     ║`);
    results.results.forEach((r, i) => {
      console.log(`║  ${i + 1}. ${r.title.substring(0, 50).padEnd(53)}║`);
      console.log(`║     ID: ${r.impiId.padEnd(47)}║`);
      console.log(`║     Status: ${r.status.padEnd(43)}║`);
      if (r.ownerName) {
        console.log(`║     Owner: ${r.ownerName.substring(0, 43).padEnd(43)}║`);
      }
      if (r.classes && r.classes.length > 0) {
        console.log(`║     Classes: ${r.classes.map(c => c.classNumber).join(', ').substring(0, 41).padEnd(41)}║`);
      }
    });
    console.log(`╚════════════════════════════════════════════════════════╝`);
  }, 120000);

  test('handles no results gracefully in API mode', async () => {
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      apiRateLimitMs: 500,
    });

    const results = await client.search('impimarciaxyznonexistent123456');

    expect(results.metadata.totalResults).toBe(0);
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBe(0);

    console.log(`\n✅ No Results Test: Correctly returned 0 results`);
  }, 90000);

  test('API mode performance comparison with vitrum', async () => {
    // API mode should be significantly faster than browser mode
    // because it only uses browser once for session, then direct HTTP calls

    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      detailLevel: 'basic',
      apiRateLimitMs: 300, // Fast rate for testing
      maxResults: 20,
    });

    const startTime = Date.now();
    const results = await client.search('vitrum');
    const duration = Date.now() - startTime;

    // Expect exactly 20 results (vitrum has 20 total)
    expect(results.results.length).toBe(20);
    expect(results.metadata.totalResults).toBe(20);

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ⚡ PERFORMANCE TEST - "vitrum"                        ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Results fetched:   ${results.results.length.toString().padEnd(36)}║`);
    console.log(`║  Total duration:    ${(duration / 1000).toFixed(2).padEnd(33)}s ║`);
    console.log(`║  Avg per result:    ${results.performance.avgPerResultMs.toString().padEnd(33)}ms ║`);
    console.log(`║  Throughput:        ${(results.results.length / (duration / 1000)).toFixed(1).padEnd(30)}r/s ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  💡 Browser mode would take ~${(results.results.length * 3).toString().padEnd(23)}s ║`);
    console.log(`║  💡 API mode is ~${Math.round((results.results.length * 3) / (duration / 1000)).toString().padEnd(31)}x faster ║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);
  }, 90000);

  test('fetches specific trademark details via API (RM200200532011)', async () => {
    // Test fetching details for a known trademark: VITRUM RM200200532011
    client = new IMPIApiClient({
      headless: true,
      humanBehavior: false,
      apiRateLimitMs: 500,
    });

    // First get a valid searchId by searching for vitrum
    const { searchId } = await client.quickSearch('vitrum');
    expect(searchId).toBeDefined();

    // Now fetch specific trademark details
    const details = await client.getTrademarkDetails('RM200200532011', searchId);

    // Validate structure
    expect(details).toBeDefined();
    expect(details.details).toBeDefined();
    expect(details.result).toBeDefined();
    expect(details.historyData).toBeDefined();

    // Validate general information
    const info = details.details!.generalInformation!;
    expect(info.title).toBe('VITRUM');
    expect(info.applicationNumber).toBe('532011');
    expect(info.registrationNumber).toBe('740798');
    expect(info.appType).toBe('REGISTRO DE MARCA');

    // Validate owner information
    const owners = details.details!.ownerInformation?.owners;
    expect(owners).toBeDefined();
    expect(owners!.length).toBeGreaterThan(0);
    expect(owners![0]!.Name![0]).toBe('UNIPHARM DE MEXICO, S.A. DE C.V.');

    // Validate products and services
    const products = details.details!.productsAndServices;
    expect(products).toBeDefined();
    expect(products!.length).toBeGreaterThan(0);
    expect(products![0]!.classes).toBe(5);
    expect(products![0]!.goodsAndServices).toContain('FARMACEUTICOS');

    // Validate trademark image
    expect(details.details!.trademark?.id).toBe('RM200200532011');
    expect(details.details!.trademark?.image).toContain('RM200200532011');

    // Validate history
    const history = details.historyData?.historyRecords;
    expect(history).toBeDefined();
    expect(history!.length).toBeGreaterThan(0);
    expect(history![0]!.description).toBe('SOLICITUD DE REGISTRO');
    expect(history![0]!.receptionYear).toBe('2002');

    // Find a history record with oficios (not all records have them)
    const historyWithOficios = history!.find(h => h.details?.oficios && h.details.oficios.length > 0);
    if (historyWithOficios) {
      const oficios = historyWithOficios.details!.oficios!;
      expect(oficios.length).toBeGreaterThan(0);
      // Check that oficios have required fields
      expect(oficios[0]!.descriptionOfTheTrade).toBeDefined();
      expect(oficios[0]!.officeNumber).toBeDefined();
    }

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  📋 SPECIFIC TRADEMARK DETAILS - RM200200532011        ║`);
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Title:             ${info.title.padEnd(36)}║`);
    console.log(`║  App Number:        ${info.applicationNumber.padEnd(36)}║`);
    console.log(`║  Reg Number:        ${info.registrationNumber!.padEnd(36)}║`);
    console.log(`║  Owner:             ${owners![0]!.Name![0]!.substring(0, 36).padEnd(36)}║`);
    console.log(`║  Class:             ${products![0]!.classes.toString().padEnd(36)}║`);
    console.log(`║  History Records:   ${history!.length.toString().padEnd(36)}║`);
    console.log(`╚════════════════════════════════════════════════════════╝`);
  }, 90000);
});
