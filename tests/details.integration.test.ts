/**
 * Integration tests for full details fetching
 *
 * Run with: pnpm test:details --testTimeout=180000
 */

import { describe, test, expect } from 'vitest';
import { IMPIScraper } from '../src/index';

// ISO date format regex: YYYY-MM-DD
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ISO datetime format regex: YYYY-MM-DDTHH:mm:ss.sssZ
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// IMPI ID format: prefix (RM, PC, NC, etc.) + year (4 digits) + application number
const IMPI_ID_REGEX = /^[A-Z]{2}\d{4}\d+$/;

// IMPI image URL formats
const IMPI_IMAGE_URL_REGEX = /^https:\/\/prod\.impi\.static\.tmv\.io\/lm\/tmimage_trim96\/MX\//;
const IMPI_ARCHIVE_URL_REGEX = /^https:\/\/acervomarcas\.impi\.gob\.mx/;

// UUID format for search ID
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

describe('Full Details Integration', () => {
  test('fetches full details for "vitrum" with complete data validation', async () => {
    const scraper = new IMPIScraper({
      headless: true,
      detailLevel: 'full',
      humanBehavior: true,
      rateLimitMs: 2000,
      maxResults: 3 // Limit to 3 results for faster test
    });

    const results = await scraper.search('vitrum');

    // ===== METADATA VALIDATION =====
    expect(results).toBeDefined();
    expect(results.metadata).toBeDefined();
    expect(results.metadata.query).toBe('vitrum');
    expect(results.metadata.executedAt).toMatch(ISO_DATETIME_REGEX);
    expect(results.metadata.searchId).not.toBeNull();
    expect(results.metadata.searchId).toMatch(UUID_REGEX);
    expect(results.metadata.searchUrl).toContain('marcia.impi.gob.mx');
    expect(results.metadata.totalResults).toBeGreaterThan(0);

    // ===== RESULTS ARRAY VALIDATION =====
    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBe(3); // Should match maxResults

    // ===== INDIVIDUAL RESULT VALIDATION =====
    for (const result of results.results) {
      // ----- Core Identifiers -----
      expect(result.impiId).toBeDefined();
      expect(result.impiId).toMatch(IMPI_ID_REGEX);

      expect(result.applicationNumber).toBeDefined();
      expect(result.applicationNumber).toMatch(/^\d+$/);

      expect(result.title).toBeDefined();
      expect(result.title.toLowerCase()).toContain('vitrum');

      expect(result.status).toBeDefined();
      expect(['REGISTRADO', 'EN TRÁMITE', 'ABANDONADO', 'NEGADO', 'CADUCADO']).toContain(result.status);

      expect(result.appType).toBeDefined();
      expect(result.appType.length).toBeGreaterThan(0);

      // ----- Date Validations -----
      // Application date should always be present
      expect(result.applicationDate).not.toBeNull();
      expect(result.applicationDate).toMatch(ISO_DATE_REGEX);

      // Other dates can be null but if present must be ISO format
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

      // ----- Image URL Validation -----
      expect(result.imageUrl).toBeDefined();
      if (typeof result.imageUrl === 'string') {
        expect(result.imageUrl).toMatch(IMPI_IMAGE_URL_REGEX);
      } else if (Array.isArray(result.imageUrl) && result.imageUrl.length > 0) {
        expect(result.imageUrl[0]).toMatch(IMPI_IMAGE_URL_REGEX);
      }

      // ----- Vienna Codes (can be null or empty string) -----
      expect(result).toHaveProperty('viennaCodes');
      if (result.viennaCodes) {
        expect(typeof result.viennaCodes).toBe('string');
      }

      // ----- Owners Validation (Full Details) -----
      expect(result.owners).toBeDefined();
      expect(result.owners).toBeInstanceOf(Array);
      expect(result.owners!.length).toBeGreaterThan(0);

      const owner = result.owners![0]!;
      expect(owner.name).toBeDefined();
      expect(owner.name.length).toBeGreaterThan(0);
      expect(owner.name).toBe(owner.name.toUpperCase()); // Company names are uppercase

      // Address should be present in full details
      expect(owner).toHaveProperty('address');
      if (owner.address) {
        expect(owner.address.length).toBeGreaterThan(0);
      }

      // Country should be present
      expect(owner).toHaveProperty('country');
      if (owner.country) {
        expect(owner.country.length).toBeGreaterThan(0);
      }

      // ownerName should match first owner
      expect(result.ownerName).toBe(owner.name);

      // ----- Classes Validation (Full Details) -----
      expect(result.classes).toBeDefined();
      expect(result.classes).toBeInstanceOf(Array);
      expect(result.classes!.length).toBeGreaterThan(0);

      const cls = result.classes![0]!;
      expect(cls.classNumber).toBeDefined();
      expect(typeof cls.classNumber).toBe('number');
      expect(cls.classNumber).toBeGreaterThanOrEqual(1);
      expect(cls.classNumber).toBeLessThanOrEqual(45); // Nice classes 1-45

      // Goods and services should have content in full details
      expect(cls.goodsAndServices).toBeDefined();
      expect(cls.goodsAndServices.length).toBeGreaterThan(0);

      // ----- Priorities Validation -----
      expect(result.priorities).toBeDefined();
      expect(result.priorities).toBeInstanceOf(Array);
      // Priorities are optional - may be empty
      if (result.priorities!.length > 0) {
        const priority = result.priorities![0]!;
        expect(priority.country).toBeDefined();
        expect(priority.applicationNumber).toBeDefined();
        if (priority.applicationDate) {
          expect(priority.applicationDate).toMatch(ISO_DATE_REGEX);
        }
      }

      // ----- History Validation (Full Details) -----
      expect(result.history).toBeDefined();
      expect(result.history).toBeInstanceOf(Array);
      expect(result.history!.length).toBeGreaterThan(0);

      const historyRecord = result.history![0]!;
      expect(historyRecord.procedureEntreeSheet).toBeDefined();
      expect(historyRecord.description).toBeDefined();
      expect(historyRecord.description.length).toBeGreaterThan(0);

      // PDF URL should be archive URL
      expect(historyRecord.pdfUrl).toBeDefined();
      expect(historyRecord.pdfUrl).toMatch(IMPI_ARCHIVE_URL_REGEX);

      // Reception year should be a valid year
      if (historyRecord.receptionYear) {
        expect(historyRecord.receptionYear).toBeGreaterThanOrEqual(1900);
        expect(historyRecord.receptionYear).toBeLessThanOrEqual(new Date().getFullYear());
      }

      // Dates in history
      if (historyRecord.startDate) {
        expect(historyRecord.startDate).toMatch(ISO_DATE_REGEX);
      }
      if (historyRecord.dateOfConclusion) {
        expect(historyRecord.dateOfConclusion).toMatch(ISO_DATE_REGEX);
      }

      // ----- Oficios Validation (Nested in History) -----
      expect(historyRecord.oficios).toBeDefined();
      expect(historyRecord.oficios).toBeInstanceOf(Array);

      if (historyRecord.oficios.length > 0) {
        const oficio = historyRecord.oficios[0]!;
        expect(oficio.description).toBeDefined();
        expect(oficio.officeNumber).toBeDefined();
        expect(oficio.officeNumber).toMatch(/^\d+$/); // Office numbers are numeric

        if (oficio.date) {
          expect(oficio.date).toMatch(ISO_DATE_REGEX);
        }

        expect(oficio.notificationStatus).toBeDefined();
        expect(oficio.pdfUrl).toBeDefined();
        expect(oficio.pdfUrl).toMatch(IMPI_ARCHIVE_URL_REGEX);
      }

      // ----- Search Context in Result -----
      expect(result.query).toBe('vitrum');
      expect(result.searchId).toBe(results.metadata.searchId);
    }

    // ===== PERFORMANCE METRICS VALIDATION =====
    expect(results.performance).toBeDefined();
    expect(results.performance.durationMs).toBeGreaterThan(0);
    expect(results.performance.avgPerResultMs).toBeGreaterThan(0);

    // Full details should take longer than basic (at least 1s per result due to API calls)
    expect(results.performance.avgPerResultMs).toBeGreaterThan(500);

    // ===== SUMMARY OUTPUT =====
    console.log(`\n📊 Full Details Results Summary:`);
    console.log(`   Query: "${results.metadata.query}"`);
    console.log(`   Total found: ${results.metadata.totalResults}`);
    console.log(`   Processed: ${results.results.length}`);
    console.log(`   Duration: ${(results.performance.durationMs / 1000).toFixed(2)}s`);
    console.log(`   Avg per result: ${(results.performance.avgPerResultMs / 1000).toFixed(2)}s`);

    // Sample first result
    const first = results.results[0]!;
    console.log(`\n📝 Sample Full Result:`);
    console.log(`   IMPI ID: ${first.impiId}`);
    console.log(`   Title: ${first.title}`);
    console.log(`   Status: ${first.status}`);
    console.log(`   Owner: ${first.ownerName}`);
    console.log(`   Address: ${first.owners?.[0]?.address || 'N/A'}`);
    console.log(`   Country: ${first.owners?.[0]?.country || 'N/A'}`);
    console.log(`   Application Date: ${first.applicationDate}`);
    console.log(`   Registration Date: ${first.registrationDate || 'N/A'}`);
    console.log(`   Expiry Date: ${first.expiryDate || 'N/A'}`);
    console.log(`   Vienna Codes: ${first.viennaCodes || 'N/A'}`);

    // Classes summary
    console.log(`\n📦 Classes:`);
    for (const cls of first.classes || []) {
      console.log(`   Class ${cls.classNumber}: ${cls.goodsAndServices.substring(0, 80)}...`);
    }

    // History summary
    console.log(`\n📜 History Records: ${first.history?.length || 0}`);
    if (first.history && first.history.length > 0) {
      const hist = first.history[0]!;
      console.log(`   First: ${hist.description} (${hist.startDate})`);
      if (hist.oficios.length > 0) {
        console.log(`   Oficios: ${hist.oficios.length}`);
        console.log(`   First Oficio: ${hist.oficios[0]!.description} - ${hist.oficios[0]!.officeNumber}`);
      }
    }
  }, 180000);
});
