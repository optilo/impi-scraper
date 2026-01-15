/**
 * IMPI API Client - Direct API access after session token extraction
 *
 * Flow:
 * 1. Boot browser, navigate to search page to get session tokens
 * 2. Close browser (or keep for token refresh)
 * 3. Hit API directly with fetch - much faster than Playwright
 *
 * Benefits:
 * - 10-50x faster than browser-based scraping for bulk operations
 * - Lower resource usage (no browser running during API calls)
 * - Looks like normal API traffic to server
 */
import { type IMPIScraperOptions, type ProxyConfig, type SearchResults, type TrademarkResult, type IMPISearchResponse, type IMPIDetailsResponse, type IMPITrademarkRaw, type SessionTokens, type GeneratedSearchResult, type GeneratedSearch, type BatchGeneratedSearch } from './types.js';
/**
 * Quick search function for IMPI trademarks
 * Uses IMPIApiClient for efficient API-based searching
 * @param query - Search term (keyword)
 * @param options - Client options
 * @returns Search results with metadata
 */
export declare function searchTrademarks(query: string, options?: IMPIScraperOptions): Promise<SearchResults>;
/**
 * Parse an IMPI search URL and extract the searchId
 * @param url - IMPI search URL (e.g., https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l&page=1)
 * @returns The extracted searchId or null if not found
 */
export declare function parseIMPISearchUrl(url: string): string | null;
/**
 * Search IMPI trademarks by URL
 * Accepts an existing IMPI search URL (with filters already applied) and scrapes all results
 * @param url - IMPI search URL (e.g., https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l&page=1)
 * @param options - Client options
 * @returns Search results with metadata
 */
export declare function searchByUrl(url: string, options?: IMPIScraperOptions): Promise<SearchResults>;
/**
 * Get only the total count of results for a keyword (no records fetched)
 * Uses IMPIApiClient under the hood; still requires a valid session token
 */
export declare function countTrademarks(query: string, options?: IMPIScraperOptions): Promise<number>;
export interface IMPIApiClientOptions extends IMPIScraperOptions {
    /** Keep browser open for token refresh (default: false) */
    keepBrowserOpen?: boolean;
    /** Session token refresh interval in ms (default: 25 minutes) */
    tokenRefreshIntervalMs?: number;
    /** Minimum delay between API calls (ms). Deprecated alias: rateLimitMs. */
    apiRateLimitMs?: number;
}
/**
 * IMPI API Client - Uses browser only for session tokens, then direct API calls
 *
 * Usage:
 * ```ts
 * const client = new IMPIApiClient({ apiRateLimitMs: 500 });
 * await client.initSession(); // Boot browser, get tokens
 * const results = await client.search('nike'); // Direct API calls
 * await client.close();
 * ```
 */
export declare class IMPIApiClient {
    private options;
    private rawProxyOption;
    private session;
    private browser;
    private context;
    private page;
    private proxyResolved;
    constructor(options?: IMPIApiClientOptions);
    /**
     * Resolve 'auto' proxy by fetching from IPFoxy
     */
    private resolveAutoProxy;
    /**
     * Initialize session by extracting tokens from browser
     */
    initSession(): Promise<void>;
    /**
     * Check if session is expired or about to expire
     */
    private isSessionExpired;
    /**
     * Ensure session is valid, refresh if needed
     */
    private ensureSession;
    /**
     * Rate-limited fetch with session headers
     */
    private apiFetch;
    /**
     * Return only the total result count for a query (no records fetched)
     */
    getCount(query: string): Promise<number>;
    /**
     * Perform quick search and get searchId (requires browser interaction)
     */
    quickSearch(query: string): Promise<{
        searchId: string;
        totalResults: number;
    }>;
    /**
     * Get search results page via direct API
     */
    getSearchResults(searchId: string, pageNumber?: number, pageSize?: number): Promise<IMPISearchResponse>;
    /**
     * Get trademark details via direct API
     */
    getTrademarkDetails(impiId: string, searchId?: string): Promise<IMPIDetailsResponse>;
    /**
     * Full search with API-only mode (browser only for session + initial search)
     */
    search(query: string): Promise<SearchResults>;
    /**
     * Progress callback for searchByUrl - called after each page is fetched
     */
    onPageFetched?: (progress: {
        page: number;
        totalPages: number;
        resultsFetched: number;
        totalResults: number;
        effectiveLimit: number;
        results: TrademarkResult[];
    }) => void | Promise<void>;
    /**
     * Progress callback for full mode - called after each detail is fetched
     */
    onDetailFetched?: (progress: {
        current: number;
        total: number;
        result: TrademarkResult;
        hasHistory: boolean;
        pdfUrls: string[];
    }) => void | Promise<void>;
    /**
     * Search by URL - accepts an existing IMPI search URL and scrapes all results
     * This is useful when you've manually applied filters on the IMPI website and want to scrape all matching results.
     * @param url - IMPI search URL (e.g., https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l&page=1)
     * @param options - Optional parameters for pagination control
     * @param options.startPage - Page to start from (0-indexed, default: 0). Use for resuming interrupted scrapes.
     * @param options.concurrency - Number of pages to fetch in parallel (default: 1)
     * @param options.detailsConcurrency - Number of details to fetch in parallel when in full mode (default: 5)
     * @param options.startDetail - Index to start detail fetching from (0-indexed, default: 0). Use for resuming interrupted full mode scrapes.
     * @returns Search results with metadata
     */
    searchByUrl(url: string, options?: {
        startPage?: number;
        concurrency?: number;
        detailsConcurrency?: number;
        startDetail?: number;
    }): Promise<SearchResults>;
    /**
     * Process raw trademark results into TrademarkResult objects
     */
    private processRawResults;
    /**
     * Build final SearchResults object
     */
    private buildSearchResults;
    /**
     * Extract basic data from raw trademark
     */
    private extractBasicData;
    /**
     * Extract full data from trademark with details
     */
    private extractTrademarkData;
    /**
     * Close browser and cleanup
     */
    closeBrowser(): Promise<void>;
    /**
     * Cleanup all resources
     */
    close(): Promise<void>;
}
export interface ConcurrentPoolOptions extends Omit<IMPIApiClientOptions, 'proxy'> {
    /** Number of concurrent workers (default: 3) */
    concurrency?: number;
    /** Array of proxies - one per worker. If fewer proxies than workers, proxies will be reused */
    proxies?: ProxyConfig[];
}
export interface ConcurrentSearchResult {
    query: string;
    results: SearchResults | null;
    error?: Error;
    workerId: number;
    proxyUsed?: string;
}
/**
 * Concurrent API Client Pool - Multiple workers with different proxies
 *
 * Usage:
 * ```ts
 * const pool = new IMPIConcurrentPool({
 *   concurrency: 3,
 *   proxies: [proxy1, proxy2, proxy3]
 * });
 *
 * // Search multiple queries in parallel
 * const results = await pool.searchMany(['nike', 'adidas', 'puma']);
 *
 * // Or process items with custom function
 * const details = await pool.processMany(trademarkIds, async (client, id) => {
 *   return client.getTrademarkDetails(id);
 * });
 *
 * await pool.close();
 * ```
 */
export declare class IMPIConcurrentPool {
    private options;
    private workers;
    private initialized;
    constructor(options?: ConcurrentPoolOptions);
    /**
     * Initialize all workers with their proxies
     */
    init(): Promise<void>;
    /**
     * Get an available worker (waits if all busy)
     */
    private getAvailableWorker;
    /**
     * Release a worker back to the pool
     */
    private releaseWorker;
    /**
     * Search multiple queries concurrently
     */
    searchMany(queries: string[]): Promise<ConcurrentSearchResult[]>;
    /**
     * Process items with a custom function using the worker pool
     */
    processMany<T, R>(items: T[], processor: (client: IMPIApiClient, item: T, workerId: number) => Promise<R>): Promise<Array<{
        item: T;
        result: R | null;
        error?: Error;
        workerId: number;
    }>>;
    /**
     * Get worker stats
     */
    getStats(): {
        total: number;
        busy: number;
        available: number;
    };
    /**
     * Close all workers and cleanup
     */
    close(): Promise<void>;
}
export interface GenerateTokensOptions {
    /** Show browser window (default: false) */
    headless?: boolean;
    /** Proxy configuration */
    proxy?: ProxyConfig;
    /** Enable human-like behavior (default: true) */
    humanBehavior?: boolean;
}
/**
 * Generate session tokens using a browser.
 *
 * This function REQUIRES Camoufox/Playwright and should be run on a machine
 * that supports browser automation (e.g., local CLI, Docker container).
 *
 * @example
 * ```typescript
 * // On local machine
 * const tokens = await generateSessionTokens();
 * console.log(`Tokens valid until: ${new Date(tokens.expiresAt!)}`);
 *
 * // Pass tokens to serverless function
 * await myQueue.trigger({ tokens, query: 'nike' });
 * ```
 */
export declare function generateSessionTokens(options?: GenerateTokensOptions): Promise<SessionTokens>;
export interface GenerateSearchIdOptions extends GenerateTokensOptions {
    /** Pre-generated tokens (if not provided, will generate new ones) */
    tokens?: SessionTokens;
}
/**
 * Generate a searchId for a query using a browser.
 *
 * This function REQUIRES Camoufox/Playwright. The returned searchId can be
 * used with IMPIHttpClient to fetch results without a browser.
 *
 * @example
 * ```typescript
 * // Generate searchId locally
 * const tokens = await generateSessionTokens();
 * const { searchId, totalResults } = await generateSearchId('nike', { tokens });
 *
 * // Pass to serverless function
 * await myQueue.trigger({ tokens, searchId, totalResults });
 * ```
 */
export declare function generateSearchId(query: string, options?: GenerateSearchIdOptions): Promise<GeneratedSearchResult>;
/**
 * Generate a complete search payload (tokens + searchId) for use in serverless functions.
 *
 * This is a convenience function that combines generateSessionTokens and generateSearchId.
 *
 * @example
 * ```typescript
 * // On local CLI
 * const search = await generateSearch('nike');
 *
 * // Pass to Trigger.dev or other queue
 * await myTask.trigger(search);
 *
 * // In the task handler (no Playwright needed)
 * const client = new IMPIHttpClient(payload.tokens);
 * const results = await client.fetchSearchResults(payload.searchId);
 * ```
 */
export declare function generateSearch(query: string, options?: GenerateTokensOptions): Promise<GeneratedSearch>;
export interface GenerateBatchSearchOptions extends GenerateTokensOptions {
    /** Delay between searches in ms (default: 500) */
    delayBetweenSearchesMs?: number;
    /** Continue on error (default: true) */
    continueOnError?: boolean;
}
/**
 * Generate search tokens and searchIds for multiple queries in ONE browser session.
 *
 * This is much more efficient than calling generateSearch() multiple times because:
 * - Opens browser only once (saves ~2-5s per query)
 * - Reuses session tokens across all queries
 * - Single session = faster + cheaper
 *
 * @example
 * ```typescript
 * // Generate batch locally
 * const batch = await generateBatchSearch(['nike', 'adidas', 'puma']);
 * console.log(`Generated ${batch.searches.length} searches, ${batch.errors.length} errors`);
 *
 * // Pass each search to Trigger.dev or other queue
 * for (const search of batch.searches) {
 *   await myTask.trigger({ tokens: batch.tokens, ...search });
 * }
 *
 * // In serverless function (no Playwright needed)
 * const client = new IMPIHttpClient(payload.tokens);
 * const results = await client.fetchAllResults(payload.searchId, payload.totalResults);
 * ```
 */
export declare function generateBatchSearch(queries: string[], options?: GenerateBatchSearchOptions): Promise<BatchGeneratedSearch>;
export interface IMPIHttpClientOptions {
    /** Detail level for fetching trademark data (default: 'basic') */
    detailLevel?: 'basic' | 'full';
}
/**
 * Pure HTTP client for IMPI API calls.
 *
 * This client does NOT require Playwright/Camoufox - it only makes HTTP requests.
 * Use this in serverless environments (Vercel, Cloudflare Workers, Lambda, etc.)
 * after generating tokens and searchId on a machine that supports browser automation.
 *
 * @example
 * ```typescript
 * // In your serverless function
 * export async function handler(payload: GeneratedSearch) {
 *   const client = new IMPIHttpClient(payload.tokens, { apiRateLimitMs: 200 });
 *
 *   // Fetch all results
 *   const results = await client.fetchAllResults(payload.searchId, payload.totalResults);
 *
 *   // Or fetch with full details
 *   const detailed = await client.fetchAllResultsWithDetails(payload.searchId, payload.totalResults);
 *
 *   return detailed;
 * }
 * ```
 */
export declare class IMPIHttpClient {
    private tokens;
    private options;
    constructor(tokens: SessionTokens, options?: IMPIHttpClientOptions);
    /**
     * Check if the tokens are expired
     */
    isTokenExpired(): boolean;
    /**
     * Get remaining token lifetime in milliseconds
     */
    getTokenLifetimeMs(): number;
    /**
     * Rate-limited fetch with token headers
     */
    private apiFetch;
    /**
     * Fetch a single page of search results
     */
    fetchSearchResults(searchId: string, pageNumber?: number, pageSize?: number): Promise<IMPISearchResponse>;
    /**
     * Fetch all search results (paginated)
     */
    fetchAllResults(searchId: string, totalResults: number, maxResults?: number): Promise<IMPITrademarkRaw[]>;
    /**
     * Fetch trademark details
     */
    fetchTrademarkDetails(impiId: string, searchId?: string): Promise<IMPIDetailsResponse>;
    /**
     * Fetch all results with full details
     */
    fetchAllResultsWithDetails(searchId: string, totalResults: number, maxResults?: number): Promise<TrademarkResult[]>;
    /**
     * Process search results into SearchResults format
     */
    processSearch(searchId: string, totalResults: number, query: string, maxResults?: number): Promise<SearchResults>;
    /**
     * Extract basic data from raw trademark
     */
    private extractBasicData;
    /**
     * Extract full data from trademark with details
     */
    private extractTrademarkData;
}
//# sourceMappingURL=api.d.ts.map