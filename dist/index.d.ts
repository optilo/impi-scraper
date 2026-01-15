/**
 * IMPI Trademark Scraper - Main Entry Point
 *
 * A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial).
 * Uses Camoufox (headless Firefox) for anti-detection with API-based data fetching.
 *
 * @example Basic search
 * ```typescript
 * import { searchTrademarks } from '@optilo/impi-scraper';
 *
 * const results = await searchTrademarks('vitrum');
 * console.log(results.results);
 * ```
 *
 * @example API client for multiple searches (reuses session - most efficient)
 * ```typescript
 * import { IMPIApiClient } from '@optilo/impi-scraper';
 *
 * const client = new IMPIApiClient({ apiRateLimitMs: 500 });
 * const results1 = await client.search('nike');
 * const results2 = await client.search('adidas');
 * await client.close();
 * ```
 *
 * @example Concurrent pool for high-throughput searching
 * ```typescript
 * import { IMPIConcurrentPool } from '@optilo/impi-scraper';
 *
 * const pool = new IMPIConcurrentPool({ concurrency: 3 });
 * const results = await pool.searchMany(['nike', 'adidas', 'puma']);
 * await pool.close();
 * ```
 */
export { IMPIApiClient, IMPIConcurrentPool, searchTrademarks, countTrademarks, searchByUrl, parseIMPISearchUrl } from './api.js';
export type { IMPIApiClientOptions, ConcurrentPoolOptions, ConcurrentSearchResult } from './api.js';
export { generateSessionTokens, generateSearchId, generateSearch, generateBatchSearch, IMPIHttpClient, } from './api.js';
export type { GenerateTokensOptions, GenerateSearchIdOptions, GenerateBatchSearchOptions, IMPIHttpClientOptions, } from './api.js';
export { parseProxyUrl, parseProxyFromEnv, resolveProxyConfig, testProxy, isProxyError, getProxyErrorMessage } from './utils/proxy.js';
export { fetchProxies, fetchProxiesFromEnv, fetchIPFoxyProxies, parseProxyProviderFromEnv } from './utils/proxy-provider.js';
export type { ProxyProviderConfig, ProxyProviderResult } from './utils/proxy-provider.js';
export { IMPIError } from './types.js';
export type { IMPIScraperOptions, ProxyConfig, IMPIErrorCode, IMPIErrorDetails, SearchMetadata, SearchResults, TrademarkResult, TrademarkOwner, TrademarkClass, TrademarkPriority, TrademarkHistory, TrademarkOficio, SessionTokens, GeneratedSearchResult, GeneratedSearch, BatchGeneratedSearch, BatchSearchError, } from './types.js';
//# sourceMappingURL=index.d.ts.map