/**
 * Type definitions for IMPI Scraper
 */
export type IMPIErrorCode = 'RATE_LIMITED' | 'BLOCKED' | 'CAPTCHA_REQUIRED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'SESSION_EXPIRED' | 'NOT_FOUND' | 'SERVER_ERROR' | 'UNKNOWN';
export interface IMPIErrorDetails {
    code: IMPIErrorCode;
    message: string;
    httpStatus?: number;
    retryAfter?: number;
    url?: string;
    timestamp: string;
}
export declare class IMPIError extends Error {
    readonly code: IMPIErrorCode;
    readonly httpStatus?: number;
    readonly retryAfter?: number;
    readonly url?: string;
    readonly timestamp: string;
    constructor(details: IMPIErrorDetails);
    toJSON(): IMPIErrorDetails;
    /** Check if error is retryable */
    get isRetryable(): boolean;
}
export interface ProxyConfig {
    server: string;
    username?: string;
    password?: string;
}
export interface IMPIScraperOptions {
    headless?: boolean;
    maxConcurrency?: number;
    maxRetries?: number;
    humanBehavior?: boolean;
    detailLevel?: 'basic' | 'full';
    maxResults?: number;
    proxy?: ProxyConfig | 'auto';
    detailTimeoutMs?: number;
    browserTimeoutMs?: number;
    debug?: boolean;
    screenshotDir?: string;
    /** Minimum delay between API calls (ms). Deprecated alias: rateLimitMs. */
    apiRateLimitMs?: number;
    /** @deprecated use apiRateLimitMs */
    rateLimitMs?: number;
}
export interface SearchMetadata {
    query: string;
    executedAt: string;
    searchId: string | null;
    searchUrl: string | null;
    totalResults?: number;
    externalIp?: string | null;
}
export interface TrademarkOwner {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
}
export interface TrademarkClass {
    classNumber: number;
    goodsAndServices: string;
}
export interface TrademarkOficio {
    description: string;
    officeNumber: string;
    date: string | null;
    notificationStatus: string;
    pdfUrl: string;
}
export interface TrademarkHistory {
    procedureEntreeSheet: string;
    description: string;
    receptionYear: number | null;
    startDate: string | null;
    dateOfConclusion: string | null;
    pdfUrl: string;
    email: string | null;
    oficios: TrademarkOficio[];
}
export interface TrademarkPriority {
    country: string;
    applicationNumber: string;
    applicationDate: string | null;
}
export interface TrademarkResult {
    query?: string;
    executedAt?: string;
    searchId?: string | null;
    searchUrl?: string | null;
    totalResults?: number;
    currentOrdinal?: number;
    impiId: string;
    detailsUrl?: string;
    title: string;
    status: string;
    applicationNumber: string;
    registrationNumber: string | null;
    appType: string;
    applicationDate: string | null;
    registrationDate: string | null;
    publicationDate: string | null;
    expiryDate: string | null;
    cancellationDate: string | null;
    goodsAndServices: string;
    viennaCodes: string | null;
    imageUrl: string | string[];
    ownerName?: string | null;
    owners?: TrademarkOwner[];
    classes?: TrademarkClass[];
    priorities?: TrademarkPriority[];
    history?: TrademarkHistory[];
}
export interface SearchResults {
    metadata: SearchMetadata;
    results: TrademarkResult[];
    performance: {
        durationMs: number;
        avgPerResultMs: number;
    };
}
export interface IMPISearchResponse {
    resultPage: IMPITrademarkRaw[];
    totalResults: number;
    searchId?: string;
    searchUrl?: string;
}
export interface IMPITrademarkRaw {
    id: string;
    title: string;
    status: string;
    applicationNumber: string;
    registrationNumber?: string;
    appType: string;
    dates?: {
        application?: string;
        registration?: string;
        publication?: string;
        expiry?: string;
        cancellation?: string;
    };
    goodsAndServices?: string;
    images?: string | string[];
    owners?: string[];
    classes?: number[];
}
/**
 * Session tokens extracted from IMPI website.
 * These tokens are required for all API calls.
 *
 * @example Using pre-generated tokens
 * ```typescript
 * // On local machine (has Playwright/Camoufox)
 * const tokens = await generateSessionTokens();
 * const { searchId } = await generateSearchId('nike', tokens);
 *
 * // Send to serverless function
 * await queue.trigger({ tokens, searchId, query: 'nike' });
 *
 * // In serverless function (no Playwright needed)
 * const client = new IMPIHttpClient(tokens);
 * const results = await client.fetchSearchResults(searchId);
 * ```
 */
export interface SessionTokens {
    /** XSRF token (URL-decoded) */
    xsrfToken: string;
    /** Java session ID */
    jsessionId: string;
    /** JWT session token */
    sessionToken: string;
    /** Timestamp when tokens were obtained (ms since epoch) */
    obtainedAt: number;
    /** JWT expiration time (ms since epoch), if available */
    expiresAt?: number;
}
/**
 * Result from generateSearchId - contains searchId for API calls
 */
export interface GeneratedSearchResult {
    /** Search ID for fetching results (UUID format) */
    searchId: string;
    /** Total number of results found */
    totalResults: number;
    /** The query that was searched */
    query: string;
}
/**
 * Combined session + search data for passing to serverless functions
 */
export interface GeneratedSearch {
    /** Session tokens for API authentication */
    tokens: SessionTokens;
    /** Search ID for fetching results */
    searchId: string;
    /** Total number of results found */
    totalResults: number;
    /** The query that was searched */
    query: string;
    /** Timestamp when this was generated */
    generatedAt: string;
}
/**
 * Error entry for batch search operations
 */
export interface BatchSearchError {
    /** The query that failed */
    query: string;
    /** Error message */
    error: string;
    /** Error code if available */
    code?: string;
}
/**
 * Batch search result - tokens + multiple searches in one browser session
 *
 * @example Using batch search
 * ```typescript
 * // On local machine (has Playwright/Camoufox)
 * const batch = await generateBatchSearch(['nike', 'adidas', 'puma']);
 *
 * // Pass to Trigger.dev or other queue
 * for (const search of batch.searches) {
 *   await myTask.trigger({ tokens: batch.tokens, ...search });
 * }
 *
 * // In serverless function (no Playwright needed)
 * const client = new IMPIHttpClient(payload.tokens);
 * const results = await client.fetchAllResults(payload.searchId, payload.totalResults);
 * ```
 */
export interface BatchGeneratedSearch {
    /** Session tokens for API authentication (shared across all searches) */
    tokens: SessionTokens;
    /** Successfully generated searches */
    searches: GeneratedSearchResult[];
    /** Failed searches with error details */
    errors: BatchSearchError[];
    /** Timestamp when batch was generated */
    generatedAt: string;
    /** Summary statistics */
    summary: {
        /** Total queries attempted */
        total: number;
        /** Successfully generated */
        successful: number;
        /** Failed to generate */
        failed: number;
        /** Total duration in milliseconds */
        durationMs: number;
    };
}
export interface IMPIDetailsResponse {
    details?: {
        generalInformation?: {
            title: string;
            applicationNumber: string;
            registrationNumber: string;
            applicationDate: string;
            registrationDate: string;
            expiryDate: string;
            appType: string;
        };
        productsAndServices?: Array<{
            classes: number;
            goodsAndServices: string;
        }>;
        prioridad?: Array<{
            country?: string;
            applicationNumber?: string;
            applicationDate?: string;
        }>;
        ownerInformation?: {
            owners?: Array<{
                Name?: string[];
                Addr?: string[];
                City?: string[];
                State?: string[];
                Cry?: string[];
            }>;
        };
        trademark?: {
            id: string;
            image: string;
            viennaCodes: string;
        };
    };
    historyData?: {
        historyRecords?: Array<{
            procedureEntreeSheet: string;
            image: string;
            description: string;
            email: string;
            dateOfConclusion: string;
            receptionYear: string;
            startDate: string;
            details?: {
                oficios?: Array<{
                    descriptionOfTheTrade: string;
                    officeNumber: string;
                    dateOfTheTrade: string;
                    notificationStatus: string;
                    image: string;
                }>;
                promociones?: unknown[];
            };
        }>;
    };
    result?: IMPITrademarkRaw;
    currentOrdinal?: number;
    totalResults?: number;
    nextId?: string;
    firstId?: string;
    lastId?: string;
}
//# sourceMappingURL=types.d.ts.map