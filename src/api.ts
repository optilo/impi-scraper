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

import { Camoufox } from 'camoufox-js';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { log } from './utils/logger.ts';
import { addHumanBehavior, randomDelay } from './utils/human-behavior.ts';
import { resolveProxyConfig, formatProxyForCamoufox } from './utils/proxy.ts';
import { fetchProxiesFromEnv } from './utils/proxy-provider.ts';
import { parseDate } from './utils/data.ts';
import {
  IMPIError,
  type IMPIScraperOptions,
  type ProxyConfig,
  type SearchResults,
  type TrademarkResult,
  type IMPISearchResponse,
  type IMPIDetailsResponse,
  type IMPITrademarkRaw,
  type SessionTokens,
  type GeneratedSearchResult,
  type GeneratedSearch,
} from './types.ts';

/**
 * Quick search function for IMPI trademarks
 * Uses IMPIApiClient for efficient API-based searching
 * @param query - Search term (keyword)
 * @param options - Client options
 * @returns Search results with metadata
 */
export async function searchTrademarks(query: string, options: IMPIScraperOptions = {}): Promise<SearchResults> {
  const client = new IMPIApiClient(options);
  try {
    return await client.search(query);
  } finally {
    await client.close();
  }
}

/**
 * Get only the total count of results for a keyword (no records fetched)
 * Uses IMPIApiClient under the hood; still requires a valid session token
 */
export async function countTrademarks(query: string, options: IMPIScraperOptions = {}): Promise<number> {
  const client = new IMPIApiClient(options);
  try {
    return await client.getCount(query);
  } finally {
    await client.close();
  }
}

// ============================================================================
// API-Only Mode Implementation
// ============================================================================

const IMPI_CONFIG = {
  baseUrl: 'https://marcia.impi.gob.mx',
  searchUrl: 'https://marcia.impi.gob.mx/marcas/search/quick',
  searchApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/result',
  searchCountApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/result/count',
  quickSearchApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/record',
  detailsApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/view',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function parseCountResponse(data: unknown, url: string): number {
  if (typeof (data as any)?.count === 'number') return (data as any).count;
  if (typeof (data as any)?.totalResults === 'number') return (data as any).totalResults;
  throw createError('PARSE_ERROR', 'Search count response missing count field', { url });
}

// SessionTokens is now imported from types.ts

export interface IMPIApiClientOptions extends IMPIScraperOptions {
  /** Keep browser open for token refresh (default: false) */
  keepBrowserOpen?: boolean;
  /** Session token refresh interval in ms (default: 25 minutes) */
  tokenRefreshIntervalMs?: number;
}

/**
 * Create an IMPIError with consistent formatting
 */
function createError(
  code: 'RATE_LIMITED' | 'BLOCKED' | 'CAPTCHA_REQUIRED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'SESSION_EXPIRED' | 'NOT_FOUND' | 'SERVER_ERROR' | 'UNKNOWN',
  message: string,
  options: { httpStatus?: number; retryAfter?: number; url?: string } = {}
): IMPIError {
  return new IMPIError({
    code,
    message,
    httpStatus: options.httpStatus,
    retryAfter: options.retryAfter,
    url: options.url,
    timestamp: new Date().toISOString()
  });
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
export class IMPIApiClient {
  private options: Required<Omit<IMPIApiClientOptions, 'proxy'>> & { proxy?: ProxyConfig };
  private rawProxyOption: ProxyConfig | 'auto' | undefined;
  private session: SessionTokens | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private proxyResolved = false;

  constructor(options: IMPIApiClientOptions = {}) {
    // Default to no proxy if not explicitly set
    // Use proxy: 'auto' to auto-fetch from IPFoxy, or provide a ProxyConfig object
    const proxyOption = options.proxy;

    // Store raw proxy option for lazy resolution (handles 'auto')
    this.rawProxyOption = proxyOption;

    // For non-auto cases, resolve immediately
    const resolvedProxy = proxyOption === 'auto' ? undefined : resolveProxyConfig(proxyOption);

    this.options = {
      headless: true,
      maxConcurrency: 1,
      maxRetries: 3,
      humanBehavior: true,
      detailLevel: 'basic',
      maxResults: 0,
      detailTimeoutMs: 30000,
      browserTimeoutMs: 300000,
      debug: false,
      screenshotDir: './screenshots',
      keepBrowserOpen: false,
      tokenRefreshIntervalMs: 25 * 60 * 1000, // 25 minutes (JWT typically expires in 30min)
      ...options,
      proxy: resolvedProxy,
    };
  }

  /**
   * Resolve 'auto' proxy by fetching from IPFoxy
   */
  private async resolveAutoProxy(): Promise<void> {
    if (this.proxyResolved) return;
    this.proxyResolved = true;

    if (this.rawProxyOption !== 'auto') return;

    log.info('Auto-fetching proxy from IPFoxy...');
    const result = await fetchProxiesFromEnv(1);

    if (!result || result.proxies.length === 0) {
      // Fall back to environment variables if IPFoxy fails
      const envProxy = resolveProxyConfig(undefined);
      if (envProxy) {
        log.info(`IPFoxy auto-fetch failed, using proxy from environment: ${envProxy.server}`);
        this.options.proxy = envProxy;
        return;
      } else {
        throw new Error(
          'Proxy required but not available.\n' +
          '  - Set IPFOXY_API_TOKEN environment variable for auto-fetch\n' +
          '  - Or set IMPI_PROXY_URL, PROXY_URL, HTTP_PROXY, or HTTPS_PROXY\n' +
          '  - Or provide proxy via options: { proxy: { server: "http://host:port" } }'
        );
      }
    }

    const proxy = result.proxies[0];
    if (proxy) {
      this.options.proxy = proxy;
      log.info(`Using auto-fetched proxy: ${this.options.proxy.server}`);
    }
  }

  /**
   * Initialize session by extracting tokens from browser
   */
  async initSession(): Promise<void> {
    if (this.session && !this.isSessionExpired()) {
      log.debug('Session still valid, reusing');
      return;
    }

    // Resolve 'auto' proxy before first use
    await this.resolveAutoProxy();

    log.info('Initializing IMPI session via Camoufox...');

    const formattedProxy = formatProxyForCamoufox(this.options.proxy);
    if (this.options.proxy) {
      log.info(`Using proxy: ${this.options.proxy.server}`);
      if (this.options.proxy.username) {
        log.debug(`Proxy username: ${this.options.proxy.username.substring(0, 50)}...`);
      }
    }

    this.browser = await Camoufox({
      headless: this.options.headless,
      geoip: true,
      proxy: formattedProxy,
      // Additional options for better proxy compatibility
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    if (!this.browser) {
      throw new Error('Failed to create Camoufox browser');
    }
    this.context = await this.browser.newContext({
      userAgent: IMPI_CONFIG.userAgent,
    });
    this.page = await this.context.newPage();

    if (this.options.humanBehavior && this.page) {
      await addHumanBehavior(this.page);
    }

    // Navigate to search page to establish session
    // Retry logic for connection issues (IMPI sometimes refuses proxy connections)
    let lastError: Error | null = null;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.debug(`Navigation attempt ${attempt}/${maxRetries} to ${IMPI_CONFIG.searchUrl}`);
        await this.page.goto(IMPI_CONFIG.searchUrl, { 
          waitUntil: 'networkidle',
          timeout: 60000 
        });
        await randomDelay(500, 1000);
        lastError = null;
        break; // Success, exit retry loop
      } catch (err) {
        lastError = err as Error;
        const errorMsg = lastError.message.toLowerCase();
        
        // If it's a connection refused error, try fetching a new proxy
        if (errorMsg.includes('connection_refused') || errorMsg.includes('ns_error_connection_refused')) {
          if (attempt < maxRetries) {
            log.warning(`Connection refused on attempt ${attempt}, fetching new proxy and retrying...`);
            
            // Close current browser
            if (this.browser) {
              await this.browser.close().catch(() => {});
              this.browser = null;
              this.context = null;
              this.page = null;
            }
            
            // Fetch a fresh proxy (with a small delay to get a different one)
            await randomDelay(1000, 2000);
            this.proxyResolved = false;
            await this.resolveAutoProxy();
            
            if (this.options.proxy) {
              log.info(`Retry with new proxy: ${this.options.proxy.server}`);
              if (this.options.proxy.username) {
                log.debug(`New proxy username: ${this.options.proxy.username.substring(0, 50)}...`);
              }
            }
            
            // Create new browser with new proxy
            const formattedProxy = formatProxyForCamoufox(this.options.proxy);
            this.browser = await Camoufox({
              headless: this.options.headless,
              geoip: true,
              proxy: formattedProxy,
            });
            if (!this.browser) {
              throw new Error('Failed to create Camoufox browser');
            }
            this.context = await this.browser.newContext({
              userAgent: IMPI_CONFIG.userAgent,
            });
            this.page = await this.context.newPage();
            
            if (this.options.humanBehavior && this.page) {
              await addHumanBehavior(this.page);
            }

            // Wait before retry
            await randomDelay(2000, 3000);
            continue;
          }
        }
        
        // For other errors or final attempt, throw
        if (attempt === maxRetries) {
          throw new Error(
            `Failed to connect to IMPI after ${maxRetries} attempts: ${lastError.message}\n` +
            `  This may indicate:\n` +
            `  - IMPI is blocking the proxy IP\n` +
            `  - Network connectivity issues\n` +
            `  - Proxy authentication problems\n` +
            `  Try fetching a new proxy or using a different proxy server.`
          );
        }
        
        // Wait before retry for other errors
        await randomDelay(1000, 2000);
      }
    }
    
    if (lastError) {
      throw lastError;
    }

    // Extract session tokens from cookies
    const cookies = await this.context.cookies();

    // Debug: log page URL and cookies
    const currentUrl = this.page!.url();
    log.debug(`Page URL after navigation: ${currentUrl}`);
    log.debug(`Cookies found: ${cookies.map(c => c.name).join(', ') || 'none'}`);

    const xsrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN');
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    const sessionCookie = cookies.find(c => c.name === 'SESSIONTOKEN');

    if (!xsrfCookie || !jsessionCookie || !sessionCookie) {
      const missing = [];
      if (!xsrfCookie) missing.push('XSRF-TOKEN');
      if (!jsessionCookie) missing.push('JSESSIONID');
      if (!sessionCookie) missing.push('SESSIONTOKEN');

      // Check if we were blocked or got CAPTCHA
      const pageContent = await this.page!.textContent('body').catch(() => '') || '';
      const pageTitle = await this.page!.title().catch(() => '');

      log.warning(`Page title: ${pageTitle}`);
      log.warning(`Page content (first 500 chars): ${pageContent.substring(0, 500)}`);

      if (pageContent.toLowerCase().includes('captcha') ||
          pageContent.toLowerCase().includes('blocked') ||
          pageContent.toLowerCase().includes('access denied')) {
        throw createError('BLOCKED', `Access blocked or CAPTCHA detected via proxy`, { url: currentUrl });
      }

      throw createError(
        'SESSION_EXPIRED',
        `Failed to obtain session tokens. Missing: ${missing.join(', ')}. URL: ${currentUrl}`,
        { url: IMPI_CONFIG.searchUrl }
      );
    }

    // Parse JWT to get expiration time
    let expiresAt: number | undefined;
    try {
      const jwtPayload = JSON.parse(atob(sessionCookie.value.split('.')[1]!));
      if (jwtPayload.exp) {
        expiresAt = jwtPayload.exp * 1000; // Convert to ms
      }
    } catch {
      // JWT parsing failed, use default expiration
    }

    this.session = {
      xsrfToken: decodeURIComponent(xsrfCookie.value),
      jsessionId: jsessionCookie.value,
      sessionToken: sessionCookie.value,
      obtainedAt: Date.now(),
      expiresAt
    };

    log.info('Session tokens obtained successfully');
    if (expiresAt) {
      const expiresIn = Math.round((expiresAt - Date.now()) / 1000 / 60);
      log.info(`Session expires in ~${expiresIn} minutes`);
    }

    // Close browser if not keeping open
    if (!this.options.keepBrowserOpen) {
      await this.closeBrowser();
    }
  }

  /**
   * Check if session is expired or about to expire
   */
  private isSessionExpired(): boolean {
    if (!this.session) return true;

    // Check JWT expiration
    if (this.session.expiresAt) {
      const buffer = 5 * 60 * 1000; // 5 minute buffer
      return Date.now() > this.session.expiresAt - buffer;
    }

    // Fallback: check against refresh interval
    const age = Date.now() - this.session.obtainedAt;
    return age > this.options.tokenRefreshIntervalMs;
  }

  /**
   * Ensure session is valid, refresh if needed
   */
  private async ensureSession(): Promise<SessionTokens> {
    if (!this.session || this.isSessionExpired()) {
      await this.initSession();
    }
    return this.session!;
  }

  /**
   * Rate-limited fetch with session headers
   */
  private async apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const session = await this.ensureSession();

    // Build cookie string
    const cookieStr = [
      `XSRF-TOKEN=${encodeURIComponent(session.xsrfToken)}`,
      `JSESSIONID=${session.jsessionId}`,
      `SESSIONTOKEN=${session.sessionToken}`
    ].join('; ');

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Cookie': cookieStr,
      'Origin': IMPI_CONFIG.baseUrl,
      'Referer': `${IMPI_CONFIG.baseUrl}/marcas/search/quick`,
      'User-Agent': IMPI_CONFIG.userAgent,
      'X-XSRF-TOKEN': session.xsrfToken,
      'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...(options.headers as Record<string, string> || {})
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle session expiration
    if (response.status === 401 || response.status === 403) {
      log.warning('Session expired, refreshing...');
      this.session = null;
      await this.initSession();
      // Retry once with new session
      return this.apiFetch(url, options);
    }

    return response;
  }

  /**
   * Return only the total result count for a query (no records fetched)
   */
  async getCount(query: string): Promise<number> {
    log.info(`Counting results for: "${query}"`);

    const response = await this.apiFetch(IMPI_CONFIG.searchCountApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({
        _type: 'Search$Quick',
        query,
        images: [],
      }),
    });

    if (!response.ok) {
      throw createError(
        response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
        `Search count API error: HTTP ${response.status}`,
        { httpStatus: response.status, url: IMPI_CONFIG.searchCountApiUrl }
      );
    }

    const data = await response.json();
    return parseCountResponse(data, IMPI_CONFIG.searchCountApiUrl);
  }

  /**
   * Perform quick search and get searchId (requires browser interaction)
   */
  async quickSearch(query: string): Promise<{ searchId: string; totalResults: number }> {
    log.info(`Quick search for: "${query}"`);

    // Ensure we have a session and browser
    await this.ensureSession();

    // Need browser for initial search to get searchId
    if (!this.browser || !this.browser.isConnected()) {
      const formattedProxy = formatProxyForCamoufox(this.options.proxy);
      this.browser = await Camoufox({
        headless: this.options.headless,
        geoip: true,
        proxy: formattedProxy,
      });
      if (!this.browser) {
        throw new Error('Failed to create Camoufox browser');
      }
      this.context = await this.browser.newContext({
        userAgent: IMPI_CONFIG.userAgent,
      });

      // Inject session cookies
      await this.context.addCookies([
        { name: 'XSRF-TOKEN', value: encodeURIComponent(this.session!.xsrfToken), domain: 'marcia.impi.gob.mx', path: '/' },
        { name: 'JSESSIONID', value: this.session!.jsessionId, domain: 'marcia.impi.gob.mx', path: '/' },
        { name: 'SESSIONTOKEN', value: this.session!.sessionToken, domain: 'marcia.impi.gob.mx', path: '/' },
      ]);

      this.page = await this.context.newPage();

      if (this.options.humanBehavior && this.page) {
        await addHumanBehavior(this.page);
      }
    }

    // Intercept the search API response with retry logic
    let searchResponse: IMPISearchResponse | null = null;
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let responseHandler: ((response: any) => Promise<void>) | null = null;
      
      try {
        let resolveSearch: () => void;
        const searchPromise = new Promise<void>((resolve) => {
          resolveSearch = resolve;
        });

        responseHandler = async (response: any) => {
          const url = response.url();
          if (url.includes('/marcas/search/internal')) {
            try {
              const data = await response.json();
              if (data.resultPage) {
                searchResponse = data;
                resolveSearch();
              }
            } catch {}
          }
        };

        this.page!.on('response', responseHandler);

        // Navigate and search with retry on connection errors
        await this.page!.goto(IMPI_CONFIG.searchUrl, { 
          waitUntil: 'networkidle',
          timeout: 60000 
        });
        await randomDelay(300, 600);

        const searchInput = await this.page!.waitForSelector('input[name="quick"], input[type="text"]', {
          timeout: 10000
        });

        if (!searchInput) {
          throw createError('PARSE_ERROR', 'Search input not found', { url: IMPI_CONFIG.searchUrl });
        }

        await searchInput.click();

        if (this.options.humanBehavior) {
          await searchInput.type(query, { delay: 30 });
        } else {
          await searchInput.fill(query);
        }

        await randomDelay(100, 300);
        await searchInput.press('Enter');

        // Wait for response with timeout
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Search timeout')), 30000);
        });

        await Promise.race([searchPromise, timeoutPromise]).catch(() => {});

        // Wait for page to settle
        await this.page!.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await randomDelay(500, 1000);

        // Extract searchId from URL
        const currentUrl = this.page!.url();
        const searchIdMatch = currentUrl.match(/[?&]s=([a-f0-9-]+)/i);
        const searchId = searchIdMatch ? searchIdMatch[1]! : '';

        // Check for no results
        if (!searchResponse) {
          const bodyText = await this.page!.textContent('body').catch(() => '') || '';
          if (bodyText.toLowerCase().includes('no hay resultados') ||
              bodyText.toLowerCase().includes('considera realizar una nueva búsqueda')) {
            if (responseHandler) {
              this.page!.off('response', responseHandler);
            }
            return { searchId: '', totalResults: 0 };
          }
          throw createError('PARSE_ERROR', 'Failed to get search results', { url: currentUrl });
        }

        // TypeScript doesn't track closure mutations, so we need to help it
        const response = searchResponse as IMPISearchResponse;
        if (responseHandler) {
          this.page!.off('response', responseHandler);
        }
        
        // Close browser if not keeping open
        if (!this.options.keepBrowserOpen) {
          await this.closeBrowser();
        }
        
        return {
          searchId,
          totalResults: response.totalResults || response.resultPage.length
        };
      } catch (err) {
        if (responseHandler) {
          this.page!.off('response', responseHandler);
        }
        
        lastError = err as Error;
        const errorMsg = lastError.message.toLowerCase();
        
        // If connection refused, try fetching a new proxy
        if ((errorMsg.includes('connection_refused') || errorMsg.includes('ns_error_connection_refused')) && attempt < maxRetries) {
          log.warning(`Connection refused on attempt ${attempt}, fetching new proxy and retrying...`);
          
          // Close current browser
          if (this.browser) {
            await this.browser.close().catch(() => {});
            this.browser = null;
            this.context = null;
            this.page = null;
          }
          
          // Fetch a fresh proxy
          this.proxyResolved = false;
          await this.resolveAutoProxy();
          
          // Re-initialize session with new proxy
          this.session = null;
          await this.initSession();
          
          // Ensure browser is created
          if (!this.browser) {
            const formattedProxy = formatProxyForCamoufox(this.options.proxy);
            this.browser = await Camoufox({
              headless: this.options.headless,
              geoip: true,
              proxy: formattedProxy,
            });
            if (!this.browser) {
              throw new Error('Failed to create Camoufox browser');
            }
            this.context = await this.browser.newContext({
              userAgent: IMPI_CONFIG.userAgent,
            });
            
            // Inject session cookies
            await this.context.addCookies([
              { name: 'XSRF-TOKEN', value: encodeURIComponent(this.session!.xsrfToken), domain: 'marcia.impi.gob.mx', path: '/' },
              { name: 'JSESSIONID', value: this.session!.jsessionId, domain: 'marcia.impi.gob.mx', path: '/' },
              { name: 'SESSIONTOKEN', value: this.session!.sessionToken, domain: 'marcia.impi.gob.mx', path: '/' },
            ]);
            
            this.page = await this.context.newPage();
            
            if (this.options.humanBehavior && this.page) {
              await addHumanBehavior(this.page);
            }
          }

          // Wait before retry
          await randomDelay(2000, 3000);
          continue;
        }
        
        // For other errors or final attempt, throw
        if (attempt === maxRetries) {
          // Close browser if not keeping open
          if (!this.options.keepBrowserOpen) {
            await this.closeBrowser();
          }
          throw new Error(
            `Failed to perform quick search after ${maxRetries} attempts: ${lastError.message}\n` +
            `  This may indicate:\n` +
            `  - IMPI is blocking the proxy IP\n` +
            `  - Network connectivity issues\n` +
            `  - Proxy authentication problems\n` +
            `  Try fetching a new proxy or using a different proxy server.`
          );
        }
        
        // Wait before retry for other errors
        await randomDelay(1000, 2000);
      }
    }
    
    // Close browser if not keeping open
    if (!this.options.keepBrowserOpen) {
      await this.closeBrowser();
    }
    
    throw lastError || new Error('Failed to perform quick search');
  }

  /**
   * Get search results page via direct API
   */
  async getSearchResults(searchId: string, pageNumber = 0, pageSize = 100): Promise<IMPISearchResponse> {
    log.debug(`Fetching results page ${pageNumber} for search ${searchId}`);

    const response = await this.apiFetch(IMPI_CONFIG.searchApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({
        searchId,
        pageSize,
        pageNumber,
        statusFilter: [],
        viennaCodeFilter: [],
        niceClassFilter: []
      })
    });

    if (!response.ok) {
      throw createError(
        response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
        `Search results API error: HTTP ${response.status}`,
        { httpStatus: response.status, url: IMPI_CONFIG.searchApiUrl }
      );
    }

    return response.json();
  }

  /**
   * Get trademark details via direct API
   */
  async getTrademarkDetails(impiId: string, searchId?: string): Promise<IMPIDetailsResponse> {
    log.debug(`Fetching details for ${impiId}`);

    const params = new URLSearchParams();
    if (searchId) {
      params.set('s', searchId);
      params.set('m', 'l');
    }
    params.set('pageSize', '100');

    const url = `${IMPI_CONFIG.detailsApiUrl}/${impiId}?${params.toString()}`;

    const response = await this.apiFetch(url);

    if (!response.ok) {
      throw createError(
        response.status === 429 ? 'RATE_LIMITED' :
        response.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR',
        `Details API error: HTTP ${response.status}`,
        { httpStatus: response.status, url }
      );
    }

    return response.json();
  }

  /**
   * Full search with API-only mode (browser only for session + initial search)
   */
  async search(query: string): Promise<SearchResults> {
    const startTime = Date.now();
    log.info(`API-mode search for: "${query}"`);

    // Get searchId via browser (one-time)
    const { searchId, totalResults } = await this.quickSearch(query);

    if (totalResults === 0 || !searchId) {
      return {
        metadata: {
          query,
          executedAt: new Date().toISOString(),
          searchId: null,
          searchUrl: null,
          totalResults: 0,
          externalIp: null
        },
        results: [],
        performance: {
          durationMs: Date.now() - startTime,
          avgPerResultMs: 0
        }
      };
    }

    // Fetch all pages via direct API
    const allResults: IMPITrademarkRaw[] = [];
    const pageSize = 100;
    const totalPages = Math.ceil(totalResults / pageSize);

    for (let page = 0; page < totalPages; page++) {
      const pageResults = await this.getSearchResults(searchId, page, pageSize);
      allResults.push(...pageResults.resultPage);

      // Apply max results limit
      if (this.options.maxResults > 0 && allResults.length >= this.options.maxResults) {
        break;
      }
    }

    // Process results
    const limit = this.options.maxResults > 0 ? this.options.maxResults : allResults.length;
    const toProcess = allResults.slice(0, limit);

    const results: TrademarkResult[] = [];

    // Fetch details if full mode
    if (this.options.detailLevel === 'full') {
      for (const trademark of toProcess) {
        try {
          const details = await this.getTrademarkDetails(trademark.id, searchId);
          results.push(this.extractTrademarkData(trademark, details, query, searchId));
        } catch (err) {
          log.warning(`Failed to get details for ${trademark.id}: ${(err as Error).message}`);
          // Add basic result on failure
          results.push(this.extractBasicData(trademark, query, searchId));
        }
      }
    } else {
      // Basic mode - no detail fetching
      for (const trademark of toProcess) {
        results.push(this.extractBasicData(trademark, query, searchId));
      }
    }

    const duration = Date.now() - startTime;

    return {
      metadata: {
        query,
        executedAt: new Date().toISOString(),
        searchId,
        searchUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=l`,
        totalResults,
        externalIp: null
      },
      results,
      performance: {
        durationMs: duration,
        avgPerResultMs: results.length > 0 ? Math.round(duration / results.length) : 0
      }
    };
  }

  /**
   * Extract basic data from raw trademark
   */
  private extractBasicData(trademark: IMPITrademarkRaw, query: string, searchId: string): TrademarkResult {
    const ownerName = trademark.owners?.[0] || null;
    const classes = trademark.classes?.map(classNum => ({
      classNumber: classNum,
      goodsAndServices: ''
    })) || [];

    return {
      query,
      searchId,
      impiId: trademark.id,
      detailsUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=d&id=${trademark.id}`,
      title: trademark.title,
      status: trademark.status,
      ownerName,
      applicationNumber: trademark.applicationNumber,
      registrationNumber: trademark.registrationNumber || null,
      appType: trademark.appType,
      applicationDate: parseDate(trademark.dates?.application),
      registrationDate: parseDate(trademark.dates?.registration),
      publicationDate: parseDate(trademark.dates?.publication),
      expiryDate: parseDate(trademark.dates?.expiry),
      cancellationDate: parseDate(trademark.dates?.cancellation),
      goodsAndServices: trademark.goodsAndServices || '',
      viennaCodes: null,
      imageUrl: trademark.images || [],
      owners: trademark.owners?.map(name => ({
        name,
        address: null,
        city: null,
        state: null,
        country: null
      })) || [],
      classes,
      priorities: [],
      history: []
    };
  }

  /**
   * Extract full data from trademark with details
   */
  private extractTrademarkData(trademark: IMPITrademarkRaw, details: IMPIDetailsResponse, query: string, searchId: string): TrademarkResult {
    const generalInfo = details?.details?.generalInformation;
    const trademarkInfo = details?.details?.trademark;

    const data: TrademarkResult = {
      query,
      searchId,
      impiId: trademark.id,
      detailsUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=d&id=${trademark.id}`,
      title: trademark.title,
      status: details?.result?.status || trademark.status,
      applicationNumber: trademark.applicationNumber,
      registrationNumber: trademark.registrationNumber || null,
      appType: trademark.appType,
      applicationDate: parseDate(generalInfo?.applicationDate || trademark.dates?.application),
      registrationDate: parseDate(generalInfo?.registrationDate || trademark.dates?.registration),
      publicationDate: parseDate(trademark.dates?.publication),
      expiryDate: parseDate(generalInfo?.expiryDate || trademark.dates?.expiry),
      cancellationDate: parseDate(trademark.dates?.cancellation),
      goodsAndServices: trademark.goodsAndServices || '',
      viennaCodes: trademarkInfo?.viennaCodes || null,
      imageUrl: trademarkInfo?.image || trademark.images || [],
      ownerName: null,
      owners: [],
      classes: [],
      priorities: [],
      history: [],
      totalResults: details?.totalResults,
      currentOrdinal: details?.currentOrdinal
    };

    // Extract owners
    const ownerInfo = details?.details?.ownerInformation?.owners;
    if (ownerInfo && Array.isArray(ownerInfo)) {
      data.owners = ownerInfo.map(owner => ({
        name: owner.Name?.[0] || '',
        address: owner.Addr?.[0] || null,
        city: owner.City?.[0] || null,
        state: owner.State?.[0] || null,
        country: owner.Cry?.[0] || null
      }));
      if (data.owners.length > 0) {
        data.ownerName = data.owners[0]!.name;
      }
    }

    // Extract classes
    const productsAndServices = details?.details?.productsAndServices;
    if (productsAndServices && Array.isArray(productsAndServices)) {
      data.classes = productsAndServices.map(item => ({
        classNumber: item.classes,
        goodsAndServices: item.goodsAndServices
      }));
      if (!data.goodsAndServices && data.classes.length > 0) {
        data.goodsAndServices = data.classes.map(c => c.goodsAndServices).join(' | ');
      }
    }

    // Extract priorities
    const prioridad = details?.details?.prioridad;
    if (prioridad && Array.isArray(prioridad)) {
      data.priorities = prioridad.map(p => ({
        country: p.country || '',
        applicationNumber: p.applicationNumber || '',
        applicationDate: parseDate(p.applicationDate)
      }));
    }

    // Extract history
    const historyRecords = details?.historyData?.historyRecords;
    if (historyRecords && Array.isArray(historyRecords)) {
      data.history = historyRecords.map(hist => ({
        procedureEntreeSheet: hist.procedureEntreeSheet,
        description: hist.description,
        receptionYear: hist.receptionYear ? parseInt(hist.receptionYear) : null,
        startDate: parseDate(hist.startDate),
        dateOfConclusion: parseDate(hist.dateOfConclusion),
        pdfUrl: hist.image,
        email: hist.email || null,
        oficios: (hist.details?.oficios || []).map(oficio => ({
          description: oficio.descriptionOfTheTrade,
          officeNumber: oficio.officeNumber,
          date: parseDate(oficio.dateOfTheTrade),
          notificationStatus: oficio.notificationStatus,
          pdfUrl: oficio.image
        }))
      }));
    }

    return data;
  }

  /**
   * Close browser and cleanup
   */
  async closeBrowser(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /**
   * Cleanup all resources
   */
  async close(): Promise<void> {
    await this.closeBrowser();
    this.session = null;
  }
}

// ============================================================================
// Concurrent Pool Implementation
// ============================================================================

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
 * Worker instance for concurrent processing
 */
interface Worker {
  id: number;
  client: IMPIApiClient;
  proxy?: ProxyConfig;
  busy: boolean;
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
export class IMPIConcurrentPool {
  private options: Required<Omit<ConcurrentPoolOptions, 'proxies'>> & { proxies: ProxyConfig[] };
  private workers: Worker[] = [];
  private initialized = false;

  constructor(options: ConcurrentPoolOptions = {}) {
    this.options = {
      headless: true,
      maxConcurrency: 1,
      maxRetries: 3,
      humanBehavior: true,
      detailLevel: 'basic',
      maxResults: 0,
      detailTimeoutMs: 30000,
      browserTimeoutMs: 300000,
      debug: false,
      screenshotDir: './screenshots',
      keepBrowserOpen: false,
      tokenRefreshIntervalMs: 25 * 60 * 1000,
      concurrency: 1,
      proxies: [],
      ...options,
    };
  }

  /**
   * Initialize all workers with their proxies
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const { concurrency, proxies, ...clientOptions } = this.options;

    log.info(`Initializing ${concurrency} concurrent workers...`);

    // Create workers with proxies (round-robin if fewer proxies than workers)
    const workerPromises: Promise<Worker>[] = [];

    for (let i = 0; i < concurrency; i++) {
      const proxy = proxies.length > 0 ? proxies[i % proxies.length] : undefined;

      const createWorker = async (): Promise<Worker> => {
        const client = new IMPIApiClient({
          ...clientOptions,
          proxy,
        });

        // Initialize session for each worker
        await client.initSession();

        log.info(`Worker ${i + 1}/${concurrency} initialized${proxy ? ` (proxy: ${proxy.server})` : ''}`);

        return {
          id: i,
          client,
          proxy,
          busy: false,
        };
      };

      workerPromises.push(createWorker());
    }

    // Initialize all workers in parallel
    this.workers = await Promise.all(workerPromises);
    this.initialized = true;

    log.info(`All ${concurrency} workers ready`);
  }

  /**
   * Get an available worker (waits if all busy)
   */
  private async getAvailableWorker(): Promise<Worker> {
    // Simple polling - find first available worker
    while (true) {
      const available = this.workers.find(w => !w.busy);
      if (available) {
        available.busy = true;
        return available;
      }
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Release a worker back to the pool
   */
  private releaseWorker(worker: Worker): void {
    worker.busy = false;
  }

  /**
   * Search multiple queries concurrently
   */
  async searchMany(queries: string[]): Promise<ConcurrentSearchResult[]> {
    if (!this.initialized) {
      await this.init();
    }

    log.info(`Starting concurrent search for ${queries.length} queries with ${this.workers.length} workers`);

    const results: ConcurrentSearchResult[] = [];
    const pending: Promise<void>[] = [];

    for (const query of queries) {
      const searchTask = async () => {
        const worker = await this.getAvailableWorker();

        try {
          log.info(`[Worker ${worker.id}] Searching: "${query}"`);
          const searchResults = await worker.client.search(query);

          results.push({
            query,
            results: searchResults,
            workerId: worker.id,
            proxyUsed: worker.proxy?.server,
          });

          log.info(`[Worker ${worker.id}] ✓ "${query}": ${searchResults.metadata.totalResults} results`);
        } catch (err) {
          const error = err as Error;
          log.error(`[Worker ${worker.id}] ✗ "${query}": ${error.message}`);

          results.push({
            query,
            results: null,
            error,
            workerId: worker.id,
            proxyUsed: worker.proxy?.server,
          });
        } finally {
          this.releaseWorker(worker);
        }
      };

      pending.push(searchTask());
    }

    // Wait for all searches to complete
    await Promise.all(pending);

    // Sort results by original query order
    const queryOrder = new Map(queries.map((q, i) => [q, i]));
    results.sort((a, b) => (queryOrder.get(a.query) ?? 0) - (queryOrder.get(b.query) ?? 0));

    return results;
  }

  /**
   * Process items with a custom function using the worker pool
   */
  async processMany<T, R>(
    items: T[],
    processor: (client: IMPIApiClient, item: T, workerId: number) => Promise<R>
  ): Promise<Array<{ item: T; result: R | null; error?: Error; workerId: number }>> {
    if (!this.initialized) {
      await this.init();
    }

    const results: Array<{ item: T; result: R | null; error?: Error; workerId: number }> = [];
    const pending: Promise<void>[] = [];

    for (const item of items) {
      const processTask = async () => {
        const worker = await this.getAvailableWorker();

        try {
          const result = await processor(worker.client, item, worker.id);
          results.push({ item, result, workerId: worker.id });
        } catch (err) {
          results.push({
            item,
            result: null,
            error: err as Error,
            workerId: worker.id,
          });
        } finally {
          this.releaseWorker(worker);
        }
      };

      pending.push(processTask());
    }

    await Promise.all(pending);
    return results;
  }

  /**
   * Get worker stats
   */
  getStats(): { total: number; busy: number; available: number } {
    const busy = this.workers.filter(w => w.busy).length;
    return {
      total: this.workers.length,
      busy,
      available: this.workers.length - busy,
    };
  }

  /**
   * Close all workers and cleanup
   */
  async close(): Promise<void> {
    log.info('Closing all workers...');

    await Promise.all(
      this.workers.map(async (worker) => {
        try {
          await worker.client.close();
        } catch {
          // Ignore cleanup errors
        }
      })
    );

    this.workers = [];
    this.initialized = false;

    log.info('All workers closed');
  }
}

// ============================================================================
// Serverless/Queue Architecture Support
// ============================================================================
// These functions separate browser-dependent operations (token/searchId generation)
// from API-only operations (fetching results/details), enabling use in environments
// that cannot run Playwright/Camoufox (e.g., Vercel, Cloudflare Workers, Lambda).

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
export async function generateSessionTokens(options: GenerateTokensOptions = {}): Promise<SessionTokens> {
  const {
    headless = true,
    proxy,
    humanBehavior = true,
  } = options;

  log.info('Generating session tokens via Camoufox...');

  const formattedProxy = formatProxyForCamoufox(proxy);
  if (proxy) {
    log.info(`Using proxy: ${proxy.server}`);
  }

  const browser = await Camoufox({
    headless,
    geoip: true,
    proxy: formattedProxy,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  if (!browser) {
    throw new Error('Failed to create Camoufox browser');
  }

  try {
    const context = await browser.newContext({
      userAgent: IMPI_CONFIG.userAgent,
    });
    const page = await context.newPage();

    if (humanBehavior) {
      await addHumanBehavior(page);
    }

    // Navigate to IMPI to get session cookies
    await page.goto(IMPI_CONFIG.searchUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await randomDelay(500, 1000);

    // Extract cookies
    const cookies = await context.cookies();
    const xsrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN');
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    const sessionCookie = cookies.find(c => c.name === 'SESSIONTOKEN');

    if (!xsrfCookie || !jsessionCookie || !sessionCookie) {
      const missing = [];
      if (!xsrfCookie) missing.push('XSRF-TOKEN');
      if (!jsessionCookie) missing.push('JSESSIONID');
      if (!sessionCookie) missing.push('SESSIONTOKEN');

      throw createError(
        'SESSION_EXPIRED',
        `Failed to obtain session tokens. Missing: ${missing.join(', ')}`,
        { url: IMPI_CONFIG.searchUrl }
      );
    }

    // Parse JWT expiration
    let expiresAt: number | undefined;
    try {
      const jwtPayload = JSON.parse(atob(sessionCookie.value.split('.')[1]!));
      if (jwtPayload.exp) {
        expiresAt = jwtPayload.exp * 1000;
      }
    } catch {
      // JWT parsing failed, use default expiration
    }

    const tokens: SessionTokens = {
      xsrfToken: decodeURIComponent(xsrfCookie.value),
      jsessionId: jsessionCookie.value,
      sessionToken: sessionCookie.value,
      obtainedAt: Date.now(),
      expiresAt,
    };

    log.info('Session tokens generated successfully');
    if (expiresAt) {
      const expiresIn = Math.round((expiresAt - Date.now()) / 1000 / 60);
      log.info(`Tokens expire in ~${expiresIn} minutes`);
    }

    return tokens;
  } finally {
    await browser.close();
  }
}

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
export async function generateSearchId(
  query: string,
  options: GenerateSearchIdOptions = {}
): Promise<GeneratedSearchResult> {
  const {
    headless = true,
    proxy,
    humanBehavior = true,
    tokens: providedTokens,
  } = options;

  log.info(`Generating searchId for query: "${query}"`);

  // Generate tokens if not provided
  const tokens = providedTokens || await generateSessionTokens({ headless, proxy, humanBehavior });

  const formattedProxy = formatProxyForCamoufox(proxy);

  const browser = await Camoufox({
    headless,
    geoip: true,
    proxy: formattedProxy,
  });

  if (!browser) {
    throw new Error('Failed to create Camoufox browser');
  }

  try {
    const context = await browser.newContext({
      userAgent: IMPI_CONFIG.userAgent,
    });

    // Inject session cookies
    await context.addCookies([
      { name: 'XSRF-TOKEN', value: encodeURIComponent(tokens.xsrfToken), domain: 'marcia.impi.gob.mx', path: '/' },
      { name: 'JSESSIONID', value: tokens.jsessionId, domain: 'marcia.impi.gob.mx', path: '/' },
      { name: 'SESSIONTOKEN', value: tokens.sessionToken, domain: 'marcia.impi.gob.mx', path: '/' },
    ]);

    const page = await context.newPage();

    if (humanBehavior) {
      await addHumanBehavior(page);
    }

    // Intercept API response
    let searchResponse: IMPISearchResponse | null = null;
    let resolveSearch: () => void;
    const searchPromise = new Promise<void>((resolve) => {
      resolveSearch = resolve;
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/marcas/search/internal')) {
        try {
          const data = await response.json();
          if (data.resultPage) {
            searchResponse = data;
            resolveSearch();
          }
        } catch {}
      }
    });

    // Navigate and search
    await page.goto(IMPI_CONFIG.searchUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await randomDelay(300, 600);

    const searchInput = await page.waitForSelector('input[name="quick"], input[type="text"]', {
      timeout: 10000,
    });

    if (!searchInput) {
      throw createError('PARSE_ERROR', 'Search input not found', { url: IMPI_CONFIG.searchUrl });
    }

    await searchInput.click();

    if (humanBehavior) {
      await searchInput.type(query, { delay: 30 });
    } else {
      await searchInput.fill(query);
    }

    await randomDelay(100, 300);
    await searchInput.press('Enter');

    // Wait for response
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout')), 30000);
    });

    await Promise.race([searchPromise, timeoutPromise]).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(500, 1000);

    // Extract searchId from URL
    const currentUrl = page.url();
    const searchIdMatch = currentUrl.match(/[?&]s=([a-f0-9-]+)/i);
    const searchId = searchIdMatch ? searchIdMatch[1]! : '';

    // Handle no results
    if (!searchResponse) {
      const bodyText = await page.textContent('body').catch(() => '') || '';
      if (bodyText.toLowerCase().includes('no hay resultados') ||
          bodyText.toLowerCase().includes('considera realizar una nueva búsqueda')) {
        return { searchId: '', totalResults: 0, query };
      }
      throw createError('PARSE_ERROR', 'Failed to get search results', { url: currentUrl });
    }

    // TypeScript doesn't track closure mutations, so we need to help it
    const response = searchResponse as IMPISearchResponse;
    log.info(`SearchId generated: ${searchId} (${response.totalResults} results)`);

    return {
      searchId,
      totalResults: response.totalResults || response.resultPage.length,
      query,
    };
  } finally {
    await browser.close();
  }
}

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
export async function generateSearch(
  query: string,
  options: GenerateTokensOptions = {}
): Promise<GeneratedSearch> {
  const tokens = await generateSessionTokens(options);
  const { searchId, totalResults } = await generateSearchId(query, { ...options, tokens });

  return {
    tokens,
    searchId,
    totalResults,
    query,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// IMPIHttpClient - Pure HTTP Client (No Browser Required)
// ============================================================================

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
export class IMPIHttpClient {
  private tokens: SessionTokens;
  private options: Required<IMPIHttpClientOptions>;

  constructor(tokens: SessionTokens, options: IMPIHttpClientOptions = {}) {
    this.tokens = tokens;
    this.options = {
      detailLevel: 'basic',
      ...options,
    };
  }

  /**
   * Check if the tokens are expired
   */
  isTokenExpired(): boolean {
    if (this.tokens.expiresAt) {
      const buffer = 5 * 60 * 1000; // 5 minute buffer
      return Date.now() > this.tokens.expiresAt - buffer;
    }
    // Default: assume 25 min lifetime
    const age = Date.now() - this.tokens.obtainedAt;
    return age > 25 * 60 * 1000;
  }

  /**
   * Get remaining token lifetime in milliseconds
   */
  getTokenLifetimeMs(): number {
    if (this.tokens.expiresAt) {
      return Math.max(0, this.tokens.expiresAt - Date.now());
    }
    // Default: assume 25 min from obtainedAt
    const defaultExpiry = this.tokens.obtainedAt + 25 * 60 * 1000;
    return Math.max(0, defaultExpiry - Date.now());
  }

  /**
   * Rate-limited fetch with token headers
   */
  private async apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (this.isTokenExpired()) {
      throw createError('SESSION_EXPIRED', 'Session tokens have expired. Generate new tokens.', { url });
    }

    // Build cookie string
    const cookieStr = [
      `XSRF-TOKEN=${encodeURIComponent(this.tokens.xsrfToken)}`,
      `JSESSIONID=${this.tokens.jsessionId}`,
      `SESSIONTOKEN=${this.tokens.sessionToken}`,
    ].join('; ');

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Cookie': cookieStr,
      'Origin': IMPI_CONFIG.baseUrl,
      'Referer': `${IMPI_CONFIG.baseUrl}/marcas/search/quick`,
      'User-Agent': IMPI_CONFIG.userAgent,
      'X-XSRF-TOKEN': this.tokens.xsrfToken,
      'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      throw createError('SESSION_EXPIRED', 'Session expired. Generate new tokens.', {
        httpStatus: response.status,
        url,
      });
    }

    return response;
  }

  /**
   * Fetch a single page of search results
   */
  async fetchSearchResults(searchId: string, pageNumber = 0, pageSize = 100): Promise<IMPISearchResponse> {
    log.debug(`Fetching results page ${pageNumber} for search ${searchId}`);

    const response = await this.apiFetch(IMPI_CONFIG.searchApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({
        searchId,
        pageSize,
        pageNumber,
        statusFilter: [],
        viennaCodeFilter: [],
        niceClassFilter: [],
      }),
    });

    if (!response.ok) {
      throw createError(
        response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
        `Search results API error: HTTP ${response.status}`,
        { httpStatus: response.status, url: IMPI_CONFIG.searchApiUrl }
      );
    }

    return response.json();
  }

  /**
   * Fetch all search results (paginated)
   */
  async fetchAllResults(searchId: string, totalResults: number, maxResults = 0): Promise<IMPITrademarkRaw[]> {
    const allResults: IMPITrademarkRaw[] = [];
    const pageSize = 100;
    const totalPages = Math.ceil(totalResults / pageSize);
    const limit = maxResults > 0 ? maxResults : totalResults;

    for (let page = 0; page < totalPages; page++) {
      const pageResults = await this.fetchSearchResults(searchId, page, pageSize);
      allResults.push(...pageResults.resultPage);

      if (allResults.length >= limit) {
        break;
      }
    }

    return allResults.slice(0, limit);
  }

  /**
   * Fetch trademark details
   */
  async fetchTrademarkDetails(impiId: string, searchId?: string): Promise<IMPIDetailsResponse> {
    log.debug(`Fetching details for ${impiId}`);

    const params = new URLSearchParams();
    if (searchId) {
      params.set('s', searchId);
      params.set('m', 'l');
    }
    params.set('pageSize', '100');

    const url = `${IMPI_CONFIG.detailsApiUrl}/${impiId}?${params.toString()}`;

    const response = await this.apiFetch(url);

    if (!response.ok) {
      throw createError(
        response.status === 429 ? 'RATE_LIMITED' :
        response.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR',
        `Details API error: HTTP ${response.status}`,
        { httpStatus: response.status, url }
      );
    }

    return response.json();
  }

  /**
   * Fetch all results with full details
   */
  async fetchAllResultsWithDetails(
    searchId: string,
    totalResults: number,
    maxResults = 0
  ): Promise<TrademarkResult[]> {
    const rawResults = await this.fetchAllResults(searchId, totalResults, maxResults);
    const results: TrademarkResult[] = [];

    for (const trademark of rawResults) {
      try {
        const details = await this.fetchTrademarkDetails(trademark.id, searchId);
        results.push(this.extractTrademarkData(trademark, details, searchId));
      } catch (err) {
        log.warning(`Failed to get details for ${trademark.id}: ${(err as Error).message}`);
        results.push(this.extractBasicData(trademark, searchId));
      }
    }

    return results;
  }

  /**
   * Process search results into SearchResults format
   */
  async processSearch(
    searchId: string,
    totalResults: number,
    query: string,
    maxResults = 0
  ): Promise<SearchResults> {
    const startTime = Date.now();

    if (totalResults === 0 || !searchId) {
      return {
        metadata: {
          query,
          executedAt: new Date().toISOString(),
          searchId: null,
          searchUrl: null,
          totalResults: 0,
          externalIp: null,
        },
        results: [],
        performance: {
          durationMs: Date.now() - startTime,
          avgPerResultMs: 0,
        },
      };
    }

    const rawResults = await this.fetchAllResults(searchId, totalResults, maxResults);
    const results: TrademarkResult[] = [];

    if (this.options.detailLevel === 'full') {
      for (const trademark of rawResults) {
        try {
          const details = await this.fetchTrademarkDetails(trademark.id, searchId);
          results.push(this.extractTrademarkData(trademark, details, searchId));
        } catch (err) {
          log.warning(`Failed to get details for ${trademark.id}: ${(err as Error).message}`);
          results.push(this.extractBasicData(trademark, searchId));
        }
      }
    } else {
      for (const trademark of rawResults) {
        results.push(this.extractBasicData(trademark, searchId));
      }
    }

    const duration = Date.now() - startTime;

    return {
      metadata: {
        query,
        executedAt: new Date().toISOString(),
        searchId,
        searchUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=l`,
        totalResults,
        externalIp: null,
      },
      results,
      performance: {
        durationMs: duration,
        avgPerResultMs: results.length > 0 ? Math.round(duration / results.length) : 0,
      },
    };
  }

  /**
   * Extract basic data from raw trademark
   */
  private extractBasicData(trademark: IMPITrademarkRaw, searchId: string): TrademarkResult {
    const ownerName = trademark.owners?.[0] || null;
    const classes = trademark.classes?.map(classNum => ({
      classNumber: classNum,
      goodsAndServices: '',
    })) || [];

    return {
      searchId,
      impiId: trademark.id,
      detailsUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=d&id=${trademark.id}`,
      title: trademark.title,
      status: trademark.status,
      ownerName,
      applicationNumber: trademark.applicationNumber,
      registrationNumber: trademark.registrationNumber || null,
      appType: trademark.appType,
      applicationDate: parseDate(trademark.dates?.application),
      registrationDate: parseDate(trademark.dates?.registration),
      publicationDate: parseDate(trademark.dates?.publication),
      expiryDate: parseDate(trademark.dates?.expiry),
      cancellationDate: parseDate(trademark.dates?.cancellation),
      goodsAndServices: trademark.goodsAndServices || '',
      viennaCodes: null,
      imageUrl: trademark.images || [],
      owners: trademark.owners?.map(name => ({
        name,
        address: null,
        city: null,
        state: null,
        country: null,
      })) || [],
      classes,
      priorities: [],
      history: [],
    };
  }

  /**
   * Extract full data from trademark with details
   */
  private extractTrademarkData(trademark: IMPITrademarkRaw, details: IMPIDetailsResponse, searchId: string): TrademarkResult {
    const generalInfo = details?.details?.generalInformation;
    const trademarkInfo = details?.details?.trademark;

    const data: TrademarkResult = {
      searchId,
      impiId: trademark.id,
      detailsUrl: `${IMPI_CONFIG.baseUrl}/marcas/search/result?s=${searchId}&m=d&id=${trademark.id}`,
      title: trademark.title,
      status: details?.result?.status || trademark.status,
      applicationNumber: trademark.applicationNumber,
      registrationNumber: trademark.registrationNumber || null,
      appType: trademark.appType,
      applicationDate: parseDate(generalInfo?.applicationDate || trademark.dates?.application),
      registrationDate: parseDate(generalInfo?.registrationDate || trademark.dates?.registration),
      publicationDate: parseDate(trademark.dates?.publication),
      expiryDate: parseDate(generalInfo?.expiryDate || trademark.dates?.expiry),
      cancellationDate: parseDate(trademark.dates?.cancellation),
      goodsAndServices: trademark.goodsAndServices || '',
      viennaCodes: trademarkInfo?.viennaCodes || null,
      imageUrl: trademarkInfo?.image || trademark.images || [],
      ownerName: null,
      owners: [],
      classes: [],
      priorities: [],
      history: [],
      totalResults: details?.totalResults,
      currentOrdinal: details?.currentOrdinal,
    };

    // Extract owners
    const ownerInfo = details?.details?.ownerInformation?.owners;
    if (ownerInfo && Array.isArray(ownerInfo)) {
      data.owners = ownerInfo.map(owner => ({
        name: owner.Name?.[0] || '',
        address: owner.Addr?.[0] || null,
        city: owner.City?.[0] || null,
        state: owner.State?.[0] || null,
        country: owner.Cry?.[0] || null,
      }));
      if (data.owners.length > 0) {
        data.ownerName = data.owners[0]!.name;
      }
    }

    // Extract classes
    const productsAndServices = details?.details?.productsAndServices;
    if (productsAndServices && Array.isArray(productsAndServices)) {
      data.classes = productsAndServices.map(item => ({
        classNumber: item.classes,
        goodsAndServices: item.goodsAndServices,
      }));
      if (!data.goodsAndServices && data.classes.length > 0) {
        data.goodsAndServices = data.classes.map(c => c.goodsAndServices).join(' | ');
      }
    }

    // Extract priorities
    const prioridad = details?.details?.prioridad;
    if (prioridad && Array.isArray(prioridad)) {
      data.priorities = prioridad.map(p => ({
        country: p.country || '',
        applicationNumber: p.applicationNumber || '',
        applicationDate: parseDate(p.applicationDate),
      }));
    }

    // Extract history
    const historyRecords = details?.historyData?.historyRecords;
    if (historyRecords && Array.isArray(historyRecords)) {
      data.history = historyRecords.map(hist => ({
        procedureEntreeSheet: hist.procedureEntreeSheet,
        description: hist.description,
        receptionYear: hist.receptionYear ? parseInt(hist.receptionYear) : null,
        startDate: parseDate(hist.startDate),
        dateOfConclusion: parseDate(hist.dateOfConclusion),
        pdfUrl: hist.image,
        email: hist.email || null,
        oficios: (hist.details?.oficios || []).map(oficio => ({
          description: oficio.descriptionOfTheTrade,
          officeNumber: oficio.officeNumber,
          date: parseDate(oficio.dateOfTheTrade),
          notificationStatus: oficio.notificationStatus,
          pdfUrl: oficio.image,
        })),
      }));
    }

    return data;
  }
}
