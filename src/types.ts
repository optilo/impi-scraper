/**
 * Type definitions for IMPI Scraper
 */

// ============================================================================
// Error Types
// ============================================================================

export type IMPIErrorCode =
  | 'RATE_LIMITED'      // HTTP 429 - Too many requests
  | 'BLOCKED'           // HTTP 403 - Access denied/blocked
  | 'CAPTCHA_REQUIRED'  // CAPTCHA challenge detected
  | 'TIMEOUT'           // Request or operation timeout
  | 'NETWORK_ERROR'     // Network connectivity issues
  | 'PARSE_ERROR'       // Failed to parse response
  | 'SESSION_EXPIRED'   // XSRF token or session invalid
  | 'NOT_FOUND'         // No results or resource not found
  | 'SERVER_ERROR'      // HTTP 5xx errors
  | 'UNKNOWN';          // Unclassified error

export interface IMPIErrorDetails {
  code: IMPIErrorCode;
  message: string;
  httpStatus?: number;
  retryAfter?: number;    // Seconds to wait before retry
  url?: string;
  timestamp: string;
}

export class IMPIError extends Error {
  readonly code: IMPIErrorCode;
  readonly httpStatus?: number;
  readonly retryAfter?: number;
  readonly url?: string;
  readonly timestamp: string;

  constructor(details: IMPIErrorDetails) {
    super(details.message);
    this.name = 'IMPIError';
    this.code = details.code;
    this.httpStatus = details.httpStatus;
    this.retryAfter = details.retryAfter;
    this.url = details.url;
    this.timestamp = details.timestamp;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IMPIError);
    }
  }

  toJSON(): IMPIErrorDetails {
    return {
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryAfter: this.retryAfter,
      url: this.url,
      timestamp: this.timestamp
    };
  }

  /** Check if error is retryable */
  get isRetryable(): boolean {
    return ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR'].includes(this.code);
  }
}

// ============================================================================
// Configuration
// ============================================================================

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
  proxy?: ProxyConfig | 'auto';  // 'auto' (default) = fetch from IPFoxy, or provide explicit ProxyConfig
  detailTimeoutMs?: number;      // Timeout for fetching individual trademark details (default: 30000)
  browserTimeoutMs?: number;     // Timeout before refreshing browser (default: 300000 = 5min)
  debug?: boolean;               // Enable debug mode: saves screenshots on errors/blocks
  screenshotDir?: string;        // Directory for debug screenshots (default: ./screenshots)
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
  externalIp?: string | null;  // IP address used for the request (useful for proxy verification)
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
  // Search context
  query?: string;
  executedAt?: string;
  searchId?: string | null;
  searchUrl?: string | null;
  totalResults?: number;
  currentOrdinal?: number;

  // Core identifiers
  impiId: string;
  detailsUrl?: string;  // Direct link to trademark details page
  title: string;
  status: string;
  applicationNumber: string;
  registrationNumber: string | null;
  appType: string;

  // Dates
  applicationDate: string | null;
  registrationDate: string | null;
  publicationDate: string | null;
  expiryDate: string | null;
  cancellationDate: string | null;

  // Content
  goodsAndServices: string;
  viennaCodes: string | null;

  // Media
  imageUrl: string | string[];

  // Owner info
  ownerName?: string | null;
  owners?: TrademarkOwner[];

  // Classifications
  classes?: TrademarkClass[];

  // Priority claims
  priorities?: TrademarkPriority[];

  // History
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

// ============================================================================
// Session & Token Types (for serverless/queue architecture)
// ============================================================================

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
