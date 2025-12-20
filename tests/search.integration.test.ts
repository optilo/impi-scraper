/**
 * Integration tests for keyword search
 *
 * Run with: pnpm test:search --testTimeout=120000
 *
 * Note: Tests run sequentially due to Crawlee's global state.
 * Each test creates a fresh memory storage to avoid conflicts.
 */

import { describe, test, expect } from 'vitest';
import { searchTrademarks } from '../src/index';

// ISO date format regex: YYYY-MM-DD
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ISO datetime format regex: YYYY-MM-DDTHH:mm:ss.sssZ
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// IMPI ID format: prefix (RM, PC, etc.) + year (4 digits) + application number
const IMPI_ID_REGEX = /^[A-Z]{2}\d{4}\d+$/;

// IMPI image URL format
const IMPI_IMAGE_URL_REGEX = /^https:\/\/prod\.impi\.static\.tmv\.io\/lm\/tmimage_trim96\/MX\//;

// UUID format for search ID
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

describe('Keyword Search Integration', () => {
  test('searches for "vitrum" trademarks with complete data validation', async () => {
    const results = await searchTrademarks('vitrum', {
      headless: true,
      detailLevel: 'basic',
      humanBehavior: true,
      rateLimitMs: 1500
    });

    // ===== METADATA VALIDATION =====
    expect(results).toBeDefined();
    expect(results.metadata).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');

    // Verify executedAt is valid ISO datetime
    expect(results.metadata.executedAt).toMatch(ISO_DATETIME_REGEX);

    // Verify search ID is valid UUID
    expect(results.metadata.searchId).not.toBeNull();
    expect(results.metadata.searchId).toMatch(UUID_REGEX);

    // Verify search URL contains the search ID
    expect(results.metadata.searchUrl).not.toBeNull();
    expect(results.metadata.searchUrl).toContain('marcia.impi.gob.mx');
    expect(results.metadata.searchUrl).toContain(results.metadata.searchId!);

    // Verify total results count
    expect(results.metadata.totalResults).toBeGreaterThan(0);

    // ===== RESULTS ARRAY VALIDATION =====
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBeGreaterThan(0);

    // ===== INDIVIDUAL RESULT VALIDATION =====
    for (const result of results.results) {
      // Core identifiers
      expect(result.impiId).toBeDefined();
      expect(result.impiId).toMatch(IMPI_ID_REGEX);

      expect(result.applicationNumber).toBeDefined();
      expect(result.applicationNumber).toMatch(/^\d+$/);

      // Title should contain search term (case-insensitive)
      expect(result.title).toBeDefined();
      expect(result.title.toLowerCase()).toContain('vitrum');

      // Status should be a known value
      expect(result.status).toBeDefined();
      expect(['REGISTRADO', 'EN TRÁMITE', 'ABANDONADO', 'NEGADO', 'CADUCADO']).toContain(result.status);

      // App type validation
      expect(result.appType).toBeDefined();
      expect(result.appType.length).toBeGreaterThan(0);

      // Date validations (can be null but if present must be ISO format)
      if (result.applicationDate) {
        expect(result.applicationDate).toMatch(ISO_DATE_REGEX);
      }
      if (result.registrationDate) {
        expect(result.registrationDate).toMatch(ISO_DATE_REGEX);
      }
      if (result.publicationDate) {
        expect(result.publicationDate).toMatch(ISO_DATE_REGEX);
      }
      if (result.expiryDate) {
        expect(result.expiryDate).toMatch(ISO_DATE_REGEX);
      }
      if (result.cancellationDate) {
        expect(result.cancellationDate).toMatch(ISO_DATE_REGEX);
      }

      // Image URL validation
      expect(result.imageUrl).toBeDefined();
      if (typeof result.imageUrl === 'string') {
        expect(result.imageUrl).toMatch(IMPI_IMAGE_URL_REGEX);
      } else if (Array.isArray(result.imageUrl) && result.imageUrl.length > 0) {
        expect(result.imageUrl[0]).toMatch(IMPI_IMAGE_URL_REGEX);
      }

      // Owners validation (array structure)
      expect(result.owners).toBeDefined();
      expect(result.owners).toBeInstanceOf(Array);
      if (result.owners && result.owners.length > 0) {
        const owner = result.owners[0]!;
        expect(owner.name).toBeDefined();
        expect(owner.name.length).toBeGreaterThan(0);
        // Owner name should be uppercase (company naming convention)
        expect(owner.name).toBe(owner.name.toUpperCase());
      }

      // ownerName should match first owner
      if (result.owners && result.owners.length > 0) {
        expect(result.ownerName).toBe(result.owners[0]!.name);
      }

      // Classes validation (array structure)
      expect(result.classes).toBeDefined();
      expect(result.classes).toBeInstanceOf(Array);
      if (result.classes && result.classes.length > 0) {
        const cls = result.classes[0]!;
        expect(cls.classNumber).toBeDefined();
        expect(typeof cls.classNumber).toBe('number');
        expect(cls.classNumber).toBeGreaterThanOrEqual(1);
        expect(cls.classNumber).toBeLessThanOrEqual(45); // Nice classes 1-45
      }

      // Search metadata should be included in each result
      expect(result.query).toBe('vitrum');
      expect(result.searchId).toBe(results.metadata.searchId);
    }

    // ===== PERFORMANCE METRICS VALIDATION =====
    expect(results.performance).toBeDefined();
    expect(results.performance.durationMs).toBeGreaterThan(0);
    expect(results.performance.avgPerResultMs).toBeGreaterThanOrEqual(0);

    // ===== SUMMARY OUTPUT =====
    console.log(`\n📊 Search Results Summary:`);
    console.log(`   Query: "${results.metadata.query}"`);
    console.log(`   Total found: ${results.metadata.totalResults}`);
    console.log(`   Processed: ${results.results.length}`);
    console.log(`   Duration: ${(results.performance.durationMs / 1000).toFixed(2)}s`);

    // Sample first result
    const first = results.results[0]!;
    console.log(`\n📝 Sample Result:`);
    console.log(`   IMPI ID: ${first.impiId}`);
    console.log(`   Title: ${first.title}`);
    console.log(`   Status: ${first.status}`);
    console.log(`   Owner: ${first.ownerName || 'N/A'}`);
    console.log(`   Application Date: ${first.applicationDate || 'N/A'}`);
    console.log(`   Classes: ${first.classes?.map(c => c.classNumber).join(', ') || 'N/A'}`);
  }, 120000);

  test('handles "no results" gracefully without false CAPTCHA detection', async () => {
    // Search for a term unlikely to have any results
    // This should return 0 results, NOT throw a CAPTCHA error
    const results = await searchTrademarks('impimarciaxyznonexistent123456', {
      headless: true,
      detailLevel: 'basic',
      humanBehavior: false,
      rateLimitMs: 1000
    });

    // Should return valid results object with 0 results
    expect(results).toBeDefined();
    expect(results.metadata).toBeDefined();
    expect(results.metadata.query).toBe('impimarciaxyznonexistent123456');

    // Verify executedAt is valid ISO datetime
    expect(results.metadata.executedAt).toMatch(ISO_DATETIME_REGEX);

    // Should have 0 total results
    expect(results.metadata.totalResults).toBe(0);

    // Results array should be empty
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBe(0);

    // Performance metrics should still be present
    expect(results.performance).toBeDefined();
    expect(results.performance.durationMs).toBeGreaterThan(0);

    console.log(`\n📊 No Results Search Test:`);
    console.log(`   Query: "${results.metadata.query}"`);
    console.log(`   Total found: ${results.metadata.totalResults}`);
    console.log(`   Duration: ${(results.performance.durationMs / 1000).toFixed(2)}s`);
    console.log(`   ✅ Correctly returned 0 results without CAPTCHA error`);
  }, 60000);
});
