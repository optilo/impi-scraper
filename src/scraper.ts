/**
 * IMPI Trademark Scraper - Core Logic
 * Uses Crawlee + Playwright for stealth scraping with human-like interactions
 */

import { PlaywrightCrawler, log, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import type { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { addHumanBehavior, randomDelay, smoothMouseMove } from './utils/human-behavior';
import { parseDate } from './utils/data';
import { detectExternalIp, resolveProxyConfig } from './utils/proxy';
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
 */
async function detectBlockingIndicators(page: Page): Promise<{ blocked: boolean; reason?: string }> {
  const bodyText = await page.textContent('body').catch(() => '') || '';
  const lowerBody = bodyText.toLowerCase();

  // Check for CAPTCHA
  if (lowerBody.includes('captcha') || lowerBody.includes('verificación humana') ||
      lowerBody.includes('robot') || lowerBody.includes('verify you are human')) {
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
      lowerBody.includes('temporarily unavailable') || lowerBody.includes('temporalmente')) {
    return { blocked: true, reason: 'Service temporarily unavailable' };
  }

  return { blocked: false };
}

export class IMPIScraper {
  private options: Required<Omit<IMPIScraperOptions, 'proxy'>> & { proxy?: ProxyConfig };
  private results: TrademarkResult[] = [];
  private searchMetadata: SearchMetadata | null = null;

  // Managed browser for detail fetching (with crash recovery)
  private managedBrowser: Browser | null = null;
  private managedContext: BrowserContext | null = null;
  private managedPage: Page | null = null;
  private browserStartTime: number = 0;

  constructor(options: IMPIScraperOptions = {}) {
    // Resolve proxy from options or environment variables
    const resolvedProxy = resolveProxyConfig(options.proxy);

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
      ...options,
      proxy: resolvedProxy, // Use resolved proxy (options > env var)
    };
  }

  /**
   * Get browser launch options with optional proxy
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
   * Create a fresh browser instance (gets new IP from rotating proxy)
   */
  private async createFreshBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    // Close existing browser if any
    await this.closeManagedBrowser();

    log.info('Creating fresh browser instance' + (this.options.proxy ? ' (new IP from rotating proxy)' : ''));

    const browser = await chromium.launch(this.getBrowserLaunchOptions());
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
   * Check if browser needs refresh (timeout or crash)
   */
  private browserNeedsRefresh(): boolean {
    if (!this.managedBrowser || !this.managedPage) return true;

    const elapsed = Date.now() - this.browserStartTime;
    if (elapsed > this.options.browserTimeoutMs) {
      log.info(`Browser timeout reached (${Math.round(elapsed / 1000)}s), will refresh`);
      return true;
    }

    return false;
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
    log.info(`Starting IMPI search for: "${query}"`);
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
      browserPoolOptions: {
        useFingerprints: false,
        retireBrowserAfterPageCount: 1, // Fresh browser for each request
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

        const xsrfToken = await self.getXsrfToken(page);
        const searchResults = await self.performSearch(page, query, xsrfToken);

        self.searchMetadata!.searchId = searchResults.searchId || null;
        self.searchMetadata!.searchUrl = searchResults.searchUrl || null;
        self.searchMetadata!.totalResults = searchResults.totalResults;

        if (self.options.detailLevel === 'basic') {
          await self.processBasicResults(searchResults.resultPage);
        } else {
          await self.processFullResults(page, searchResults.resultPage, xsrfToken);
        }
      }
    });

    // Add unique key to prevent URL deduplication across runs
    const uniqueKey = `${IMPI_CONFIG.searchUrl}#${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await crawler.run([{ url: IMPI_CONFIG.searchUrl, uniqueKey }]);
    await crawler.teardown();

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
   */
  private async getXsrfToken(page: Page): Promise<string> {
    log.debug('Obtaining XSRF token');

    await page.goto(IMPI_CONFIG.searchUrl, { waitUntil: 'networkidle' });

    if (this.options.humanBehavior) {
      await randomDelay(500, 1500);
    }

    // Check for blocking indicators before proceeding
    const blockCheck = await detectBlockingIndicators(page);
    if (blockCheck.blocked) {
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
   */
  private async performSearch(page: Page, query: string, xsrfToken: string): Promise<IMPISearchResponse> {
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

    await page.goto(IMPI_CONFIG.searchUrl);

    if (this.options.humanBehavior) {
      await randomDelay(800, 1500);
    }

    // Check for blocking before interacting
    const blockCheck = await detectBlockingIndicators(page);
    if (blockCheck.blocked) {
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

    // Move mouse to input (human-like)
    if (this.options.humanBehavior) {
      const box = await searchInput.boundingBox();
      if (box) {
        await smoothMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        await randomDelay(200, 500);
      }
    }

    await searchInput.click();
    await randomDelay(100, 300);

    // Type query character by character (human-like)
    if (this.options.humanBehavior) {
      for (const char of query) {
        await searchInput.type(char, { delay: Math.random() * 100 + 50 });
      }
    } else {
      await searchInput.fill(query);
    }

    await randomDelay(300, 700);

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
    await randomDelay(500, 1000);

    // Extract search ID from URL
    const currentUrl = page.url();
    const searchIdMatch = currentUrl.match(/[?&]s=([a-f0-9-]+)/i);
    const searchId = searchIdMatch ? searchIdMatch[1] : undefined;

    // Check for results
    if (!searchData || !searchData.resultPage) {
      // Check for blocking indicators
      const blockCheck = await detectBlockingIndicators(page);
      if (blockCheck.blocked) {
        const isCaptcha = blockCheck.reason?.includes('CAPTCHA');
        const isRateLimit = blockCheck.reason?.includes('Rate limit');
        throw createError(
          isCaptcha ? 'CAPTCHA_REQUIRED' : isRateLimit ? 'RATE_LIMITED' : 'BLOCKED',
          blockCheck.reason || 'Request blocked after search submission',
          { url: currentUrl }
        );
      }

      const noResultsText = await page.textContent('body').catch(() => '');
      if (noResultsText?.includes('No hay resultados') ||
          noResultsText?.includes('No results') ||
          noResultsText?.includes('Considera realizar una nueva búsqueda') ||
          noResultsText?.includes('otros criterios')) {
        log.info('No results found for this search');
        return {
          resultPage: [],
          totalResults: 0,
          searchId,
          searchUrl: currentUrl
        };
      }

      // If we had a timeout and still no data, throw the timeout error
      if (timeoutError) {
        throw timeoutError;
      }

      throw createError(
        'PARSE_ERROR',
        'Failed to intercept search results - response format may have changed',
        { url: currentUrl }
      );
    }

    const totalResults = searchData.totalResults || searchData.resultPage.length;
    const allResults = [...searchData.resultPage];

    // Handle pagination if needed
    const resultsPerPage = searchData.resultPage.length;
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

      this.results.push({
        ...this.searchMetadata!,
        impiId: trademark.id,
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

      log.debug(`Fetching details ${i + 1}/${toProcess.length}: ${trademark.id}`);

      if (i > 0) {
        await randomDelay(this.options.rateLimitMs, this.options.rateLimitMs + 1000);
      }

      // Check if browser needs refresh (timeout)
      if (this.browserNeedsRefresh() && browserRestarts < maxBrowserRestarts) {
        try {
          log.info(`Refreshing browser before trademark ${i + 1}/${toProcess.length}`);
          const { page: newPage } = await this.createFreshBrowser();
          currentPage = newPage;
          currentXsrfToken = await this.getXsrfToken(currentPage);
          browserRestarts++;
          log.info(`Browser refreshed successfully (restart ${browserRestarts}/${maxBrowserRestarts})`);
        } catch (refreshErr) {
          log.warn(`Failed to refresh browser: ${(refreshErr as Error).message}`);
        }
      }

      // Retry logic with browser recovery
      let retries = 0;
      const maxRetries = this.options.maxRetries;
      let success = false;

      while (retries <= maxRetries && !success) {
        try {
          const details = await this.fetchTrademarkDetailsWithTimeout(currentPage, trademark.id, currentXsrfToken);
          const extracted = this.extractTrademarkData(trademark, details);

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
              log.error(`Failed at trademark ${i + 1}/${toProcess.length}: ${trademark.id}`);
              return; // Exit early - too many browser crashes
            }

            log.warn(`Browser crash detected at trademark ${trademark.id}, spawning fresh browser (restart ${browserRestarts + 1}/${maxBrowserRestarts})`);

            try {
              const { page: newPage } = await this.createFreshBrowser();
              currentPage = newPage;
              currentXsrfToken = await this.getXsrfToken(currentPage);
              browserRestarts++;
              log.info(`Browser recovered successfully, retrying trademark ${trademark.id}`);
              // Don't increment retries for browser recovery - we want to retry the same trademark
              retries--;
            } catch (recoveryErr) {
              log.error(`Failed to recover browser: ${(recoveryErr as Error).message}`);
              browserRestarts++;
            }
          } else if (retries <= maxRetries) {
            log.warn(`Retry ${retries}/${maxRetries} for trademark ${trademark.id}: ${error.message}`);
            await randomDelay(2000, 4000); // Wait before retry
          } else {
            log.error(`Failed to process trademark ${trademark.id} after ${maxRetries} retries: ${error.message}`);
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

    const data: TrademarkResult = {
      // Core identifiers
      impiId: trademark.id,
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
        data.ownerName = data.owners[0].name;
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
