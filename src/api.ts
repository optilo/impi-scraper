/**
 * Simple API wrapper for quick searches
 */

import { IMPIScraper } from './scraper';
import type { IMPIScraperOptions, SearchResults } from './types';

/**
 * Quick search function for IMPI trademarks
 * @param query - Search term (keyword)
 * @param options - Scraper options
 * @returns Search results with metadata
 */
export async function searchTrademarks(query: string, options: IMPIScraperOptions = {}): Promise<SearchResults> {
  const scraper = new IMPIScraper(options);
  return await scraper.search(query);
}
