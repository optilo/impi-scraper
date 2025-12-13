/**
 * IMPI Trademark Scraper - Main Entry Point
 *
 * A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial).
 * Uses Crawlee + Playwright with human-like interactions and anti-detection features.
 *
 * @example Basic search (uses API mode by default - fastest)
 * ```typescript
 * import { searchTrademarks } from '@optilo/impi-scraper';
 *
 * const results = await searchTrademarks('vitrum');
 * console.log(results.results);
 * ```
 *
 * @example API client for multiple searches (reuses session)
 * ```typescript
 * import { IMPIApiClient } from '@optilo/impi-scraper';
 *
 * const client = new IMPIApiClient({ apiRateLimitMs: 500 });
 * const results1 = await client.search('nike');
 * const results2 = await client.search('adidas');
 * await client.close();
 * ```
 *
 * @example Full browser mode (legacy, slower but more robust)
 * ```typescript
 * import { IMPIScraper } from '@optilo/impi-scraper';
 *
 * const scraper = new IMPIScraper({ detailLevel: 'full' });
 * const results = await scraper.search('nike');
 * ```
 */

// API mode (recommended - faster, uses browser only for session tokens)
export { IMPIApiClient, searchTrademarks } from './api';
export type { IMPIApiClientOptions } from './api';

// Browser mode (legacy - full browser control)
export { IMPIScraper } from './scraper';
export { parseProxyUrl, parseProxyFromEnv, resolveProxyConfig, testProxy, isProxyError, getProxyErrorMessage } from './utils/proxy';
export { fetchProxies, fetchProxiesFromEnv, fetchIPFoxyProxies, parseProxyProviderFromEnv } from './utils/proxy-provider';
export type { ProxyProviderConfig, ProxyProviderResult } from './utils/proxy-provider';
export {
  // Error class
  IMPIError
} from './types';
export type {
  // Configuration
  IMPIScraperOptions,
  ProxyConfig,

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
