/**
 * IMPI Trademark Scraper - Main Entry Point
 *
 * A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial).
 * Uses Crawlee + Playwright with human-like interactions and anti-detection features.
 *
 * @example Basic search
 * ```typescript
 * import { searchTrademarks } from '@optilo/impi-scraper';
 *
 * const results = await searchTrademarks('vitrum');
 * console.log(results.results);
 * ```
 *
 * @example Full details search
 * ```typescript
 * import { IMPIScraper } from '@optilo/impi-scraper';
 *
 * const scraper = new IMPIScraper({ detailLevel: 'full' });
 * const results = await scraper.search('nike');
 * ```
 */

export { IMPIScraper } from './scraper';
export { searchTrademarks } from './api';
export {
  // Error class
  IMPIError
} from './types';
export type {
  // Configuration
  IMPIScraperOptions,

  // Errors
  IMPIErrorCode,
  IMPIErrorDetails,

  // Results
  SearchMetadata,
  SearchResults,
  TrademarkResult,

  // Trademark details
  TrademarkOwner,
  TrademarkClass,
  TrademarkPriority,
  TrademarkHistory,
  TrademarkOficio
} from './types';
