/**
 * IMPI Trademark Scraper - Core Logic
 * Uses Camoufox (Firefox-based) for stealth scraping with human-like interactions
 * Falls back to Playwright/Crawlee for full detail searches with pagination
 */

import { PlaywrightCrawler, log, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import { Camoufox } from 'camoufox-js';
import type { Page, Browser, BrowserContext } from 'playwright-core';
import { chromium } from 'playwright';
import { addHumanBehavior, randomDelay } from './utils/human-behavior';
import { parseDate } from './utils/data';
import { detectExternalIp, resolveProxyConfig, formatProxyForCamoufox } from './utils/proxy';
import {
  IMPIError,
  type IMPIScraperOptions,
  type IMPIErrorCode,
  type SearchMetadata,
  type TrademarkResult,
  type SearchResults,
  type IMPITrademarkRaw,
  type IMPIDetailsResponse,
  type IMPISearchResponse,
  type ProxyConfig
} from './types';

const IMPI_CONFIG = {
  searchUrl: 'https://marcia.impi.gob.mx/marcas/search/quick',
  searchApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/record',
  detailsApiUrl: 'https://marcia.impi.gob.mx/marcas/search/internal/view',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Create an IMPIError with consistent formatting
 */
function createError(
  code: IMPIErrorCode,
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
 * Detect error type from HTTP status code
 */
function getErrorCodeFromStatus(status: number): IMPIErrorCode {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 403) return 'BLOCKED';
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

/**
 * Check page content for CAPTCHA or block indicators
 * Returns: { blocked, reason, isNoResults }
 */
async function detectBlockingIndicators(page: Page): Promise<{ blocked: boolean; reason?: string; isNoResults?: boolean }> {
  const bodyText = await page.textContent('body').catch(() => '') || '';
  const lowerBody = bodyText.toLowerCase();

  // FIRST: Check for "no results" - this is NOT a block, don't confuse with CAPTCHA
  if (lowerBody.includes('no hay resultados') ||
      lowerBody.includes('no results') ||
      lowerBody.includes('considera realizar una nueva búsqueda') ||
      lowerBody.includes('otros criterios')) {
    return { blocked: false, isNoResults: true };
  }

  // Check for CAPTCHA - be more specific to avoid false positives
  if ((lowerBody.includes('captcha') && !lowerBody.includes('resultado')) ||
      lowerBody.includes('verificación humana') ||
      lowerBody.includes('verify you are human') ||
      lowerBody.includes('i\'m not a robot')) {
    return { blocked: true, reason: 'CAPTCHA verification required' };
  }

  // Check for rate limiting messages
  if (lowerBody.includes('too many requests') || lowerBody.includes('demasiadas solicitudes') ||
      lowerBody.includes('rate limit') || lowerBody.includes('límite de solicitudes')) {
    return { blocked: true, reason: 'Rate limit exceeded' };
  }

  // Check for access denied
  if (lowerBody.includes('access denied') || lowerBody.includes('acceso denegado') ||
      lowerBody.includes('forbidden') || lowerBody.includes('prohibido')) {
    return { blocked: true, reason: 'Access denied' };
  }

  // Check for maintenance
  if (lowerBody.includes('maintenance') || lowerBody.includes('mantenimiento') ||
      lowerBody.includes('temporarily unavailable')) {
    return { blocked: true, reason: 'Service temporarily unavailable' };
  }

  return { blocked: false };
}

export class IMPIScraper {
  private options: Required<Omit<IMPIScraperOptions, 'proxy'>> & { proxy?: ProxyConfig };
  private rawProxyOption: ProxyConfig | 'auto' | null | undefined;
  private results: TrademarkResult[] = [];
  private searchMetadata: SearchMetadata | null = null;

  // Managed browser for detail fetching (with crash recovery)
  private managedBrowser: Browser | null = null;
  private managedContext: BrowserContext | null = null;
  private managedPage: Page | null = null;
  private browserStartTime: number = 0;
  private proxyResolved = false;

  constructor(options: IMPIScraperOptions = {}) {
    // Default to 'auto' proxy if not explicitly set
    // This means: try to auto-fetch from IPFoxy, fall back to env vars, or no proxy if neither available
    const proxyOption = options.proxy !== undefined ? options.proxy : 'auto';
    this.rawProxyOption = proxyOption;

    // Resolve proxy from options or environment variables
    // Handle 'auto' proxy option (will be resolved later when needed)
    const resolvedProxy = proxyOption === 'auto' ? undefined : resolveProxyConfig(proxyOption);

    this.options = {
      headless: true,
      rateLimitMs: 2000,
      maxConcurrency: 1,
      maxRetries: 3,
      humanBehavior: true,
      detailLevel: 'basic',
      maxResults: 0, // 0 = no limit
      detailTimeoutMs: 30000, // 30 seconds per detail fetch
      browserTimeoutMs: 300000, // 5 minutes before browser refresh
      debug: false,
      screenshotDir: './screenshots',
      ...options,
      proxy: resolvedProxy, // Use resolved proxy (options > env var), 'auto' handled separately
    };
  }

  /**
   * Resolve 'auto' proxy by fetching from IPFoxy
   */
  private async resolveAutoProxy(): Promise<void> {
    if (this.proxyResolved) return;
    this.proxyResolved = true;

    if (this.rawProxyOption !== 'auto') return;

    const { fetchProxiesFromEnv } = await import('./utils/proxy-provider');
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
   * Save debug screenshot when blocking or errors occur
   */
  private async saveDebugScreenshot(page: Page, reason: string, query?: string): Promise<string | null> {
    if (!this.options.debug) return null;

    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(this.options.screenshotDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedQuery = query?.replace(/[^a-z0-9]/gi, '_').slice(0, 20) || 'unknown';
      const sanitizedReason = reason.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
      const filename = `${this.options.screenshotDir}/${timestamp}_${sanitizedQuery}_${sanitizedReason}.png`;

      await page.screenshot({ path: filename, fullPage: true });
      log.info(`Debug screenshot saved: ${filename}`);
      return filename;
    } catch (err) {
      log.warning(`Failed to save debug screenshot: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Get browser launch options with optional proxy (for Playwright/Crawlee)
   */
  private getBrowserLaunchOptions() {
    const launchOptions: any = {
      headless: this.options.headless,
      timeout: 60000,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]
    };

    // Add proxy if configured
    if (this.options.proxy) {
      launchOptions.proxy = {
        server: this.options.proxy.server,
        username: this.options.proxy.username,
        password: this.options.proxy.password,
      };
      log.info(`Proxy configured: ${this.options.proxy.server}`);
    }

    return launchOptions;
  }

  /**
   * Create Camoufox browser instance (for direct search)
   */
  private async createCamoufoxBrowser() {
    // Resolve 'auto' proxy before creating browser
    await this.resolveAutoProxy();

    const formattedProxy = formatProxyForCamoufox(this.options.proxy);
    if (this.options.proxy) {
      log.info(`Using Camoufox with proxy: ${this.options.proxy.server}`);
    } else {
      log.info('Using Camoufox without proxy');
    }

    return await Camoufox({
      headless: this.options.headless,
      geoip: true,
      proxy: formattedProxy,
      // Additional options for better proxy compatibility
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
  }

  /**
   * Create a fresh browser instance (gets new IP from rotating proxy)
   */
  private async createFreshBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    // Close existing browser if any
    await this.closeManagedBrowser();

    log.info('Creating fresh Camoufox browser instance' + (this.options.proxy ? ' (new IP from rotating proxy)' : ''));

    const browser = await this.createCamoufoxBrowser();
    const context = await browser.newContext({
      userAgent: IMPI_CONFIG.userAgent,
    });
    const page = await context.newPage();

    this.managedBrowser = browser;
    this.managedContext = context;
    this.managedPage = page;
    this.browserStartTime = Date.now();

    return { browser, context, page };
  }

  /**
   * Close the managed browser
   */
  private async closeManagedBrowser(): Promise<void> {
    try {
      if (this.managedPage) {
        await this.managedPage.close().catch(() => {});
        this.managedPage = null;
      }
      if (this.managedContext) {
        await this.managedContext.close().catch(() => {});
        this.managedContext = null;
      }
      if (this.managedBrowser) {
        await this.managedBrowser.close().catch(() => {});
        this.managedBrowser = null;
      }
    } catch (err) {
      log.debug(`Error closing browser: ${(err as Error).message}`);
    }
  }

  /**
   * Check if browser needs refresh (only on crash, not timeout)
   */
  private browserNeedsRefresh(): boolean {
    // Only refresh if browser/page is null (crashed or closed)
    return !this.managedBrowser || !this.managedPage;
  }

  /**
   * Check if error indicates browser crash/closure
   */
  private isBrowserCrashError(err: Error): boolean {
    const message = err.message.toLowerCase();
    return message.includes('target page, context or browser has been closed') ||
           message.includes('browser has been closed') ||
           message.includes('context has been closed') ||
           message.includes('page has been closed') ||
           message.includes('protocol error') ||
           message.includes('connection refused') ||
           message.includes('target closed');
  }

  /**
   * Search IMPI for trademarks by keyword
   */
  async search(query: string): Promise<SearchResults> {
    log.debug(`Search options: detailLevel=${this.options.detailLevel}`);

    // For basic detail level, use simple direct search (no Crawlee overhead)
    if (this.options.detailLevel === 'basic') {
      return this.searchDirect(query);
    }

    // For full details, use Crawlee-based search
    return this.searchWithCrawlee(query);
  }

  /**
   * Simple direct search using Playwright only (no Crawlee)
   * Much faster and simpler for basic searches
   */
  private async searchDirect(query: string): Promise<SearchResults> {
    log.info(`Starting IMPI search for: "${query}" (direct mode)`);
    if (this.options.proxy) {
      log.info(`Using proxy: ${this.options.proxy.server}`);
    }

    const startTime = Date.now();
    this.results = [];
    this.searchMetadata = {
      query,
      executedAt: new Date().toISOString(),
      searchId: null,
      searchUrl: null,
      externalIp: null
    };

    let browser: Browser | null = null;

    try {
      // Launch single Camoufox browser
      browser = await this.createCamoufoxBrowser();
      const context = await browser.newContext({
        userAgent: IMPI_CONFIG.userAgent,
      });
      const page = await context.newPage();

      // Detect external IP if proxy configured
      if (this.options.proxy) {
        try {
          // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
          const externalIp = await detectExternalIp(page);
          this.searchMetadata.externalIp = externalIp;
          if (externalIp) {
            log.info(`External IP: ${externalIp}`);
          }
        } catch (ipErr) {
          log.debug(`Could not detect external IP: ${(ipErr as Error).message}`);
        }
      }

      if (this.options.humanBehavior) {
        // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
        await addHumanBehavior(page);
      }

      // Navigate once and get token
      const xsrfToken = await this.getXsrfToken(page, false);

      // Perform search (page is already on search URL from getXsrfToken)
      const searchResults = await this.performSearch(page, query, xsrfToken, true);

      this.searchMetadata.searchId = searchResults.searchId || null;
      this.searchMetadata.searchUrl = searchResults.searchUrl || null;
      this.searchMetadata.totalResults = searchResults.totalResults;

      // Process basic results
      await this.processBasicResults(searchResults.resultPage);

    } finally {
      // Clean up
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    const duration = Date.now() - startTime;

    log.info(`Search completed in ${(duration / 1000).toFixed(2)}s`, {
      totalResults: this.searchMetadata?.totalResults,
      processed: this.results.length
    });

    return {
      metadata: this.searchMetadata!,
      results: this.results,
      performance: {
        durationMs: duration,
        avgPerResultMs: this.results.length > 0 ? Math.round(duration / this.results.length) : 0
      }
    };
  }

  /**
   * Batch search - process multiple queries with a single browser session
   * Much more efficient for checking many domains
   *
   * @param queries - Array of search queries (keywords)
   * @param onResult - Callback called after each search completes
   * @returns Summary of batch operation
   */
  async searchBatch(
    queries: string[],
    onResult?: (query: string, result: SearchResults | null, error?: Error) => void | Promise<void>
  ): Promise<{
    successful: number;
    failed: number;
    results: Map<string, SearchResults>;
    errors: Map<string, Error>;
  }> {
    log.info(`Starting batch search for ${queries.length} queries`);

    const results = new Map<string, SearchResults>();
    const errors = new Map<string, Error>();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let xsrfToken: string | null = null;

    const startTime = Date.now();

    try {
      // Launch single Camoufox browser for all searches
      browser = await this.createCamoufoxBrowser();
      context = await browser.newContext({
        userAgent: IMPI_CONFIG.userAgent,
      });
      page = await context.newPage();

      if (this.options.humanBehavior) {
        // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
        await addHumanBehavior(page);
      }

      // Get initial XSRF token
      xsrfToken = await this.getXsrfToken(page, false);

      // Process each query
      for (let i = 0; i < queries.length; i++) {
        const query = queries[i]!;
        log.info(`[${i + 1}/${queries.length}] Searching: "${query}"`);

        try {
          // Reset state for this search
          this.results = [];
          const metadata: SearchMetadata = {
            query,
            executedAt: new Date().toISOString(),
            searchId: null,
            searchUrl: null,
            externalIp: null
          };
          this.searchMetadata = metadata;

          // Perform search (page should already be on search URL or we navigate)
          const searchResults = await this.performSearch(page!, query, xsrfToken!, true);

          metadata.searchId = searchResults.searchId || null;
          metadata.searchUrl = searchResults.searchUrl || null;
          metadata.totalResults = searchResults.totalResults;

          // Process basic results
          await this.processBasicResults(searchResults.resultPage);

          const result: SearchResults = {
            metadata,
            results: this.results,
            performance: {
              durationMs: 0,
              avgPerResultMs: 0
            }
          };

          results.set(query, result);

          // Callback with result
          if (onResult) {
            await onResult(query, result);
          }

          // Navigate directly to search page for next query
          // (don't use goBack - after pagination it may land on wrong page)
          if (i < queries.length - 1) {
            await randomDelay(500, 1000);
            await page!.goto(IMPI_CONFIG.searchUrl, { waitUntil: 'networkidle' });
            await randomDelay(this.options.rateLimitMs, this.options.rateLimitMs + 500);
          }

        } catch (err) {
          const error = err as Error;
          errors.set(query, error);
          log.error(`Error searching "${query}": ${error.message}`);

          // Callback with error
          if (onResult) {
            await onResult(query, null, error);
          }

          // Check if we need to restart browser (blocked/rate limited)
          const isBlocked = error.message.includes('BLOCKED') ||
                           error.message.includes('RATE_LIMITED') ||
                           error.message.includes('CAPTCHA');

          if (!isBlocked && i < queries.length - 1) {
            // Navigate back to search page for next query
            try {
              await randomDelay(500, 1000);
              await page!.goto(IMPI_CONFIG.searchUrl, { waitUntil: 'networkidle' });
              await randomDelay(1000, 2000);
            } catch {
              // Ignore navigation errors
            }
          }

          if (isBlocked && this.options.proxy) {
            log.info('Blocked - restarting browser with new proxy connection...');
            try {
              await page?.close().catch(() => {});
              await context?.close().catch(() => {});
              await browser?.close().catch(() => {});

              // Wait before retry
              await randomDelay(30000, 60000);

              // Restart browser (gets new IP from rotating proxy)
              browser = await this.createCamoufoxBrowser();
              context = await browser.newContext({
                userAgent: IMPI_CONFIG.userAgent,
              });
              page = await context.newPage();

              if (this.options.humanBehavior) {
                // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
                await addHumanBehavior(page);
              }

              xsrfToken = await this.getXsrfToken(page, false);
              log.info('Browser restarted successfully');
            } catch (restartErr) {
              log.error(`Failed to restart browser: ${(restartErr as Error).message}`);
              break; // Exit batch on browser restart failure
            }
          }
        }
      }

    } finally {
      // Clean up browser
      try {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
        await browser?.close().catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }

    const duration = Date.now() - startTime;
    log.info(`Batch search completed in ${(duration / 1000).toFixed(1)}s: ${results.size} successful, ${errors.size} failed`);

    return {
      successful: results.size,
      failed: errors.size,
      results,
      errors
    };
  }

  /**
   * Full search using Crawlee (for detailed results with pagination)
   */
  private async searchWithCrawlee(query: string): Promise<SearchResults> {
    log.info(`Starting IMPI search for: "${query}" (crawlee mode)`);
    if (this.options.proxy) {
      log.info(`Using proxy: ${this.options.proxy.server}`);
    }

    const startTime = Date.now();
    this.results = [];
    this.searchMetadata = {
      query,
      executedAt: new Date().toISOString(),
      searchId: null,
      searchUrl: null,
      externalIp: null
    };

    const self = this;

    // Create isolated in-memory storage for each crawler instance
    // This ensures each search starts fresh without cached request state
    const storage = new MemoryStorage({
      persistStorage: false,
      writeMetadata: false,
    });

    // Reset the global configuration to use fresh storage
    const config = Configuration.getGlobalConfig();
    config.set('persistStorage', false);
    config.useStorageClient(storage);

    const crawler = new PlaywrightCrawler({
      headless: this.options.headless,
      maxConcurrency: this.options.maxConcurrency,
      maxRequestRetries: this.options.maxRetries,
      useSessionPool: false,
      requestHandlerTimeoutSecs: 600, // 10 minutes for full detail fetches
      navigationTimeoutSecs: 60, // 1 minute for page navigation
      keepAlive: false, // Don't keep browsers alive after crawling
      browserPoolOptions: {
        useFingerprints: false,
        retireBrowserAfterPageCount: 100, // Keep browser alive for pagination
        closeInactiveBrowserAfterSecs: 10, // Close browsers when idle
      },

      launchContext: {
        launchOptions: this.getBrowserLaunchOptions()
      },

      async requestHandler({ page, request, log }) {
        log.info(`Processing: ${request.url}`);

        // Detect external IP (verifies proxy is working if configured)
        try {
          const externalIp = await detectExternalIp(page);
          self.searchMetadata!.externalIp = externalIp;
          if (externalIp) {
            log.info(`External IP: ${externalIp}`);
          }
        } catch (ipErr) {
          log.debug(`Could not detect external IP: ${(ipErr as Error).message}`);
        }

        if (self.options.humanBehavior) {
          await addHumanBehavior(page);
        }

        // Crawler already navigated to search URL, so skip redundant navigations
        // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
        const xsrfToken = await self.getXsrfToken(page, true);
        // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
        const searchResults = await self.performSearch(page, query, xsrfToken, true);

        self.searchMetadata!.searchId = searchResults.searchId || null;
        self.searchMetadata!.searchUrl = searchResults.searchUrl || null;
        self.searchMetadata!.totalResults = searchResults.totalResults;

        if (self.options.detailLevel === 'basic') {
          await self.processBasicResults(searchResults.resultPage);
        } else {
          // @ts-expect-error - Playwright type compatibility between Camoufox and Playwright versions
          await self.processFullResults(page, searchResults.resultPage, xsrfToken);
        }
      }
    });

    // Add unique key to prevent URL deduplication across runs
    const uniqueKey = `${IMPI_CONFIG.searchUrl}#${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      await crawler.run([{ url: IMPI_CONFIG.searchUrl, uniqueKey }]);
    } finally {
      // Ensure crawler and browser pool are fully cleaned up
      try {
        await crawler.teardown();
      } catch (e) {
        log.debug(`Crawler teardown error: ${(e as Error).message}`);
      }
      // Force close any managed browsers from full detail fetches
      await this.closeManagedBrowser();
      // Give event loop a moment to clean up
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const duration = Date.now() - startTime;

    log.info(`Search completed in ${(duration / 1000).toFixed(2)}s`, {
      totalResults: this.searchMetadata?.totalResults,
      processed: this.results.length
    });

    return {
      metadata: this.searchMetadata!,
      results: this.results,
      performance: {
        durationMs: duration,
        avgPerResultMs: this.results.length > 0 ? Math.round(duration / this.results.length) : 0
      }
    };
  }

  /**
   * Get XSRF token from cookies
   * @param page - The page to get token from
   * @param skipNavigation - If true, assumes page is already on the search URL
   */
  private async getXsrfToken(page: Page, skipNavigation = false): Promise<string> {
    log.debug('Obtaining XSRF token');

    if (!skipNavigation) {
      await page.goto(IMPI_CONFIG.searchUrl, { waitUntil: 'networkidle' });
    }

    if (this.options.humanBehavior) {
      await randomDelay(200, 500);
    }

    // Check for blocking indicators before proceeding
    const blockCheck = await detectBlockingIndicators(page);
    if (blockCheck.blocked) {
      await this.saveDebugScreenshot(page, blockCheck.reason || 'blocked', 'xsrf_token');
      const isCaptcha = blockCheck.reason?.includes('CAPTCHA');
      throw createError(
        isCaptcha ? 'CAPTCHA_REQUIRED' : 'BLOCKED',
        blockCheck.reason || 'Access blocked',
        { url: IMPI_CONFIG.searchUrl }
      );
    }

    const cookies = await page.context().cookies();
    const xsrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN');

    if (!xsrfCookie) {
      throw createError(
        'SESSION_EXPIRED',
        'Failed to obtain XSRF token - session may be blocked or expired',
        { url: IMPI_CONFIG.searchUrl }
      );
    }

    const token = decodeURIComponent(xsrfCookie.value);
    log.debug('XSRF token obtained');

    return token;
  }

  /**
   * Perform search with human-like interaction
   * @param page - The page already on the search URL
   * @param query - Search query
   * @param xsrfToken - XSRF token for API calls
   * @param skipNavigation - If true, assumes page is already on search URL
   */
  private async performSearch(page: Page, query: string, xsrfToken: string, skipNavigation = false): Promise<IMPISearchResponse> {
    log.info('Performing search with human-like behavior');

    let searchData: IMPISearchResponse | null = null;
    let resolveSearchData: () => void;
    const searchDataPromise = new Promise<void>((resolve) => {
      resolveSearchData = resolve;
    });

    // Intercept API responses - set up BEFORE any navigation
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/marcas/search/internal')) {
        try {
          const data = await response.json();
          if (data.resultPage && data.resultPage.length > 0) {
            searchData = data as IMPISearchResponse;
            resolveSearchData();
          }
        } catch {
          // Not JSON or parse error
        }
      }
    });

    // Only navigate if not already on the search page
    if (!skipNavigation) {
      await page.goto(IMPI_CONFIG.searchUrl);
    }

    if (this.options.humanBehavior) {
      await randomDelay(300, 600);
    }

    // Check for blocking before interacting
    const blockCheck = await detectBlockingIndicators(page);
    if (blockCheck.blocked) {
      await this.saveDebugScreenshot(page, blockCheck.reason || 'blocked', query);
      const isCaptcha = blockCheck.reason?.includes('CAPTCHA');
      const isRateLimit = blockCheck.reason?.includes('Rate limit');
      throw createError(
        isCaptcha ? 'CAPTCHA_REQUIRED' : isRateLimit ? 'RATE_LIMITED' : 'BLOCKED',
        blockCheck.reason || 'Access blocked during search',
        { url: page.url() }
      );
    }

    // Find and interact with search input
    const searchInput = await page.waitForSelector('input[name="quick"], input[type="text"]', {
      timeout: 10000
    }).catch(() => null);

    if (!searchInput) {
      throw createError(
        'PARSE_ERROR',
        'Search input not found - page structure may have changed',
        { url: page.url() }
      );
    }

    await searchInput.click();

    // Type query - slightly slower if humanBehavior enabled
    if (this.options.humanBehavior) {
      await searchInput.type(query, { delay: 30 }); // ~30ms per char
    } else {
      await searchInput.fill(query);
    }

    await randomDelay(100, 300);

    // Submit search
    await searchInput.press('Enter');

    // Wait for API response or timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(createError(
        'TIMEOUT',
        'Search API timeout - no response within 30 seconds',
        { url: page.url() }
      )), 30000);
    });

    let timeoutError: IMPIError | null = null;
    try {
      await Promise.race([searchDataPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof IMPIError) {
        timeoutError = err;
      }
      // Will check searchData below
    }

    // Also wait for page to settle
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(200, 400);

    // Extract search ID from URL
    const currentUrl = page.url();
    const searchIdMatch = currentUrl.match(/[?&]s=([a-f0-9-]+)/i);
    const searchId = searchIdMatch ? searchIdMatch[1] : undefined;

    // Check for results (type assertion needed because TypeScript doesn't track closure mutations)
    const hasResults = searchData !== null && (searchData as IMPISearchResponse).resultPage !== undefined;
    if (!hasResults) {
      // Check for blocking indicators (this also detects "no results" pages)
      const blockCheck = await detectBlockingIndicators(page);

      // Handle "no results" - this is NOT an error
      if (blockCheck.isNoResults) {
        log.info('No results found for this search');
        return {
          resultPage: [],
          totalResults: 0,
          searchId,
          searchUrl: currentUrl
        };
      }

      // Handle actual blocks
      if (blockCheck.blocked) {
        await this.saveDebugScreenshot(page, blockCheck.reason || 'blocked', query);
        const isCaptcha = blockCheck.reason?.includes('CAPTCHA');
        const isRateLimit = blockCheck.reason?.includes('Rate limit');
        throw createError(
          isCaptcha ? 'CAPTCHA_REQUIRED' : isRateLimit ? 'RATE_LIMITED' : 'BLOCKED',
          blockCheck.reason || 'Request blocked after search submission',
          { url: currentUrl }
        );
      }

      // If we had a timeout and still no data, throw the timeout error
      if (timeoutError) {
        throw timeoutError;
      }

      // Unknown state - save debug screenshot
      await this.saveDebugScreenshot(page, 'no_results_unknown', query);
      throw createError(
        'PARSE_ERROR',
        'Failed to intercept search results - response format may have changed',
        { url: currentUrl }
      );
    }

    // At this point, searchData is guaranteed to have resultPage due to the check above
    // Double assertion needed because TypeScript doesn't track closure mutations
    const validSearchData = searchData as unknown as IMPISearchResponse;
    const totalResults = validSearchData.totalResults || validSearchData.resultPage.length;
    const allResults = [...validSearchData.resultPage];

    // Handle pagination if needed
    const resultsPerPage = validSearchData.resultPage.length;
    if (totalResults > resultsPerPage) {
      const totalPages = Math.ceil(totalResults / resultsPerPage);
      log.info(`Pagination detected: ${totalPages} pages`);

      for (let pageNum = 1; pageNum < totalPages; pageNum++) {
        searchData = null;

        await randomDelay(this.options.rateLimitMs, this.options.rateLimitMs + 1000);

        const pageUrl = `https://marcia.impi.gob.mx/marcas/search/result?s=${searchId}&m=l&page=${pageNum}`;
        await page.goto(pageUrl, { waitUntil: 'networkidle' });
        await randomDelay(1500, 2500);

        if (searchData && (searchData as IMPISearchResponse).resultPage) {
          allResults.push(...(searchData as IMPISearchResponse).resultPage);
        }
      }
    }

    return {
      resultPage: allResults,
      totalResults,
      searchId,
      searchUrl: currentUrl
    };
  }

  /**
   * Process basic results (no additional API calls)
   */
  private async processBasicResults(trademarks: IMPITrademarkRaw[]): Promise<void> {
    const limit = this.options.maxResults > 0 ? this.options.maxResults : trademarks.length;
    const toProcess = trademarks.slice(0, limit);
    log.info(`Processing ${toProcess.length} basic results`);

    for (const trademark of toProcess) {
      // Extract owner name from raw owners array
      const ownerName = trademark.owners?.[0] || null;

      // Convert raw classes array to structured format
      const classes = trademark.classes?.map(classNum => ({
        classNumber: classNum,
        goodsAndServices: '' // Not available in basic results
      })) || [];

      // Build details URL from searchId and trademark ID
      const detailsUrl = this.searchMetadata?.searchId
        ? `https://marcia.impi.gob.mx/marcas/search/result?s=${this.searchMetadata.searchId}&m=d&id=${trademark.id}`
        : undefined;

      this.results.push({
        ...this.searchMetadata!,
        impiId: trademark.id,
        detailsUrl,
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
        viennaCodes: null, // Not available in basic results
        imageUrl: trademark.images || [],
        owners: trademark.owners?.map(name => ({
          name,
          address: null,
          city: null,
          state: null,
          country: null
        })) || [],
        classes,
        priorities: [], // Not available in basic results
        history: [] // Not available in basic results
      });
    }
  }

  /**
   * Process full results (with detail API calls)
   * Uses managed browser with crash recovery - spawns fresh browser with new IP on failure
   */
  private async processFullResults(page: Page, trademarks: IMPITrademarkRaw[], xsrfToken: string): Promise<void> {
    const limit = this.options.maxResults > 0 ? this.options.maxResults : trademarks.length;
    const toProcess = trademarks.slice(0, limit);
    log.info(`Processing ${toProcess.length} full results with details`);

    // Track current XSRF token (may need to refresh after browser restart)
    let currentXsrfToken = xsrfToken;
    let currentPage: Page = page;
    let browserRestarts = 0;
    const maxBrowserRestarts = 5;

    for (let i = 0; i < toProcess.length; i++) {
      const trademark = toProcess[i];

      log.debug(`Fetching details ${i + 1}/${toProcess.length}: ${trademark!.id}`);

      if (i > 0) {
        await randomDelay(this.options.rateLimitMs, this.options.rateLimitMs + 1000);
      }

      // Check if browser needs refresh (only if crashed/closed)
      if (this.browserNeedsRefresh() && browserRestarts < maxBrowserRestarts) {
        try {
          log.info(`Browser needs recovery before trademark ${i + 1}/${toProcess.length}`);
          const { page: newPage } = await this.createFreshBrowser();
          currentPage = newPage;
          currentXsrfToken = await this.getXsrfToken(currentPage);
          browserRestarts++;
          log.info(`Browser refreshed successfully (restart ${browserRestarts}/${maxBrowserRestarts})`);
        } catch (refreshErr) {
          log.warning(`Failed to refresh browser: ${(refreshErr as Error).message}`);
        }
      }

      // Retry logic with browser recovery
      let retries = 0;
      const maxRetries = this.options.maxRetries;
      let success = false;

      while (retries <= maxRetries && !success) {
        try {
          const details = await this.fetchTrademarkDetailsWithTimeout(currentPage, trademark!.id, currentXsrfToken);
          const extracted = this.extractTrademarkData(trademark!, details);

          this.results.push({
            ...this.searchMetadata!,
            ...extracted
          });
          success = true;
        } catch (err) {
          const error = err as Error;
          retries++;

          // Check if this is a browser crash error
          if (this.isBrowserCrashError(error)) {
            if (browserRestarts >= maxBrowserRestarts) {
              log.error(`Max browser restarts (${maxBrowserRestarts}) reached, skipping remaining trademarks`);
              log.error(`Failed at trademark ${i + 1}/${toProcess.length}: ${trademark!.id}`);
              return; // Exit early - too many browser crashes
            }

            log.warning(`Browser crash detected at trademark ${trademark!.id}, spawning fresh browser (restart ${browserRestarts + 1}/${maxBrowserRestarts})`);

            try {
              const { page: newPage } = await this.createFreshBrowser();
              currentPage = newPage;
              currentXsrfToken = await this.getXsrfToken(currentPage);
              browserRestarts++;
              log.info(`Browser recovered successfully, retrying trademark ${trademark!.id}`);
              // Don't increment retries for browser recovery - we want to retry the same trademark
              retries--;
            } catch (recoveryErr) {
              log.error(`Failed to recover browser: ${(recoveryErr as Error).message}`);
              browserRestarts++;
            }
          } else if (retries <= maxRetries) {
            log.warning(`Retry ${retries}/${maxRetries} for trademark ${trademark!.id}: ${error.message}`);
            await randomDelay(2000, 4000); // Wait before retry
          } else {
            log.error(`Failed to process trademark ${trademark!.id} after ${maxRetries} retries: ${error.message}`);
          }
        }
      }
    }

    // Cleanup managed browser
    await this.closeManagedBrowser();

    log.info(`Processed ${this.results.length}/${toProcess.length} trademarks (${browserRestarts} browser restarts)`);
  }

  /**
   * Fetch trademark details with timeout
   */
  private async fetchTrademarkDetailsWithTimeout(page: Page, impiId: string, xsrfToken: string): Promise<IMPIDetailsResponse> {
    const timeoutMs = this.options.detailTimeoutMs;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(createError(
          'TIMEOUT',
          `Detail fetch timeout after ${timeoutMs}ms for trademark ${impiId}`,
          { url: `${IMPI_CONFIG.detailsApiUrl}/${impiId}` }
        ));
      }, timeoutMs);
    });

    return Promise.race([
      this.fetchTrademarkDetails(page, impiId, xsrfToken),
      timeoutPromise
    ]);
  }

  /**
   * Fetch detailed trademark information
   */
  private async fetchTrademarkDetails(page: Page, impiId: string, xsrfToken: string): Promise<IMPIDetailsResponse> {
    const detailsUrl = `${IMPI_CONFIG.detailsApiUrl}/${impiId}`;

    const response = await page.request.get(detailsUrl, {
      headers: {
        'x-xsrf-token': xsrfToken,
        'Accept': 'application/json'
      }
    });

    if (!response.ok()) {
      const status = response.status();
      const errorCode = getErrorCodeFromStatus(status);

      // Extract retry-after header for rate limiting
      let retryAfter: number | undefined;
      if (status === 429) {
        const retryHeader = response.headers()['retry-after'];
        if (retryHeader) {
          retryAfter = parseInt(retryHeader, 10);
        }
      }

      throw createError(
        errorCode,
        `Failed to fetch trademark details: HTTP ${status}`,
        { httpStatus: status, retryAfter, url: detailsUrl }
      );
    }

    try {
      return await response.json() as IMPIDetailsResponse;
    } catch {
      throw createError(
        'PARSE_ERROR',
        'Failed to parse trademark details response',
        { url: detailsUrl }
      );
    }
  }

  /**
   * Extract structured data from details
   */
  private extractTrademarkData(trademark: IMPITrademarkRaw, detailsData: IMPIDetailsResponse): TrademarkResult {
    const generalInfo = detailsData?.details?.generalInformation;
    const trademarkInfo = detailsData?.details?.trademark;

    // Build details URL from searchId and trademark ID
    const detailsUrl = this.searchMetadata?.searchId
      ? `https://marcia.impi.gob.mx/marcas/search/result?s=${this.searchMetadata.searchId}&m=d&id=${trademark.id}`
      : undefined;

    const data: TrademarkResult = {
      // Core identifiers
      impiId: trademark.id,
      detailsUrl,
      title: trademark.title,
      status: detailsData?.result?.status || trademark.status,
      applicationNumber: trademark.applicationNumber,
      registrationNumber: trademark.registrationNumber || null,
      appType: trademark.appType,

      // Dates
      applicationDate: parseDate(generalInfo?.applicationDate || trademark.dates?.application),
      registrationDate: parseDate(generalInfo?.registrationDate || trademark.dates?.registration),
      publicationDate: parseDate(trademark.dates?.publication),
      expiryDate: parseDate(generalInfo?.expiryDate || trademark.dates?.expiry),
      cancellationDate: parseDate(trademark.dates?.cancellation),

      // Content
      goodsAndServices: trademark.goodsAndServices || '',
      viennaCodes: trademarkInfo?.viennaCodes || null,

      // Media - prefer detail image if available
      imageUrl: trademarkInfo?.image || trademark.images || [],

      // Initialize arrays
      ownerName: null,
      owners: [],
      classes: [],
      priorities: [],
      history: [],

      // Navigation context from details response
      totalResults: detailsData?.totalResults,
      currentOrdinal: detailsData?.currentOrdinal
    };

    // Extract owners
    const ownerInfo = detailsData?.details?.ownerInformation?.owners;
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

    // Extract classes with goods and services
    const productsAndServices = detailsData?.details?.productsAndServices;
    if (productsAndServices && Array.isArray(productsAndServices)) {
      data.classes = productsAndServices.map(item => ({
        classNumber: item.classes,
        goodsAndServices: item.goodsAndServices
      }));

      // Also populate goodsAndServices from first class if not already set
      if (!data.goodsAndServices && data.classes.length > 0) {
        data.goodsAndServices = data.classes.map(c => c.goodsAndServices).join(' | ');
      }
    }

    // Extract priority claims
    const prioridad = detailsData?.details?.prioridad;
    if (prioridad && Array.isArray(prioridad)) {
      data.priorities = prioridad.map(p => ({
        country: p.country || '',
        applicationNumber: p.applicationNumber || '',
        applicationDate: parseDate(p.applicationDate)
      }));
    }

    // Extract history with oficios
    const historyRecords = detailsData?.historyData?.historyRecords;
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
}
