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
// Main API (uses Camoufox for session + direct API calls)
export { IMPIApiClient, IMPIConcurrentPool, searchTrademarks, countTrademarks, searchByUrl, parseIMPISearchUrl } from './api.js';
// Serverless/Queue Architecture Support
// These functions separate browser-dependent (token generation) from API-only operations
export { 
// Token & SearchId generation (requires Camoufox/Playwright)
generateSessionTokens, generateSearchId, generateSearch, 
// Batch generation (one browser session for multiple queries)
generateBatchSearch, 
// Pure HTTP client (no browser required - for serverless)
IMPIHttpClient, } from './api.js';
// Proxy utilities
export { parseProxyUrl, parseProxyFromEnv, resolveProxyConfig, testProxy, isProxyError, getProxyErrorMessage } from './utils/proxy.js';
export { fetchProxies, fetchProxiesFromEnv, fetchIPFoxyProxies, parseProxyProviderFromEnv } from './utils/proxy-provider.js';
// Error handling and types
export { IMPIError } from './types.js';
//# sourceMappingURL=index.js.map