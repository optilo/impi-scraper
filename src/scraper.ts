/**
 * IMPI Trademark Scraper - Core Logic
 * Uses Crawlee + Playwright for stealth scraping with human-like interactions
 */

import { PlaywrightCrawler, log, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import type { Page } from 'playwright';
import { addHumanBehavior, randomDelay, smoothMouseMove } from './utils/human-behavior';
import { parseDate } from './utils/data';
import {
  IMPIError,
  type IMPIScraperOptions,
  type IMPIErrorCode,
  type SearchMetadata,
  type TrademarkResult,
  type SearchResults,
  type IMPITrademarkRaw,
  type IMPIDetailsResponse,
  type IMPISearchResponse
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
  private options: Required<IMPIScraperOptions>;
  private results: TrademarkResult[] = [];
  private searchMetadata: SearchMetadata | null = null;

  constructor(options: IMPIScraperOptions = {}) {
    this.options = {
      headless: true,
      rateLimitMs: 2000,
      maxConcurrency: 1,
      maxRetries: 3,
      humanBehavior: true,
      detailLevel: 'basic',
      maxResults: 0, // 0 = no limit
      ...options
    };
  }

  /**
   * Search IMPI for trademarks by keyword
   */
  async search(query: string): Promise<SearchResults> {
    log.info(`Starting IMPI search for: "${query}"`);

    const startTime = Date.now();
    this.results = [];
    this.searchMetadata = {
      query,
      executedAt: new Date().toISOString(),
      searchId: null,
      searchUrl: null
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
        launchOptions: {
          headless: this.options.headless,
          timeout: 60000, // 1 minute browser launch timeout
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage',
          ]
        }
      },

      async requestHandler({ page, request, log }) {
        log.info(`Processing: ${request.url}`);

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
      if (noResultsText?.includes('No hay resultados') || noResultsText?.includes('No results')) {
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
   */
  private async processFullResults(page: Page, trademarks: IMPITrademarkRaw[], xsrfToken: string): Promise<void> {
    const limit = this.options.maxResults > 0 ? this.options.maxResults : trademarks.length;
    const toProcess = trademarks.slice(0, limit);
    log.info(`Processing ${toProcess.length} full results with details`);

    for (let i = 0; i < toProcess.length; i++) {
      const trademark = toProcess[i];

      log.debug(`Fetching details ${i + 1}/${toProcess.length}: ${trademark.id}`);

      if (i > 0) {
        await randomDelay(this.options.rateLimitMs, this.options.rateLimitMs + 1000);
      }

      try {
        const details = await this.fetchTrademarkDetails(page, trademark.id, xsrfToken);
        const extracted = this.extractTrademarkData(trademark, details);

        this.results.push({
          ...this.searchMetadata!,
          ...extracted
        });
      } catch (err) {
        log.error(`Failed to process trademark ${trademark.id}: ${(err as Error).message}`);
      }
    }
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
