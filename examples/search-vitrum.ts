/**
 * Example: Search for "vitrum" trademarks
 * Demonstrates basic usage of the IMPI scraper
 *
 * Run with: pnpm example:vitrum
 */

import { searchTrademarks } from '../src/index';

async function main() {
  console.log('Searching IMPI for "vitrum" trademarks...\n');

  try {
    const results = await searchTrademarks('vitrum', {
      detailLevel: 'basic', // Use 'full' for detailed information
      headless: true,       // Set to false to see browser
      rateLimitMs: 2000,    // 2 seconds between requests
      humanBehavior: true   // Enable human-like interactions
    });

    console.log('Search completed!\n');
    console.log('Metadata:', {
      query: results.metadata.query,
      totalResults: results.metadata.totalResults,
      searchId: results.metadata.searchId,
      executedAt: results.metadata.executedAt
    });

    console.log('\nPerformance:', {
      duration: `${(results.performance.durationMs / 1000).toFixed(2)}s`,
      avgPerResult: `${results.performance.avgPerResultMs}ms`
    });

    console.log(`\nFound ${results.results.length} trademarks:\n`);

    // Display first 5 results
    results.results.slice(0, 5).forEach((trademark, index) => {
      console.log(`${index + 1}. ${trademark.title}`);
      console.log(`   ID: ${trademark.impiId}`);
      console.log(`   Status: ${trademark.status}`);
      console.log(`   Application #: ${trademark.applicationNumber}`);
      console.log(`   Registration #: ${trademark.registrationNumber || 'N/A'}`);
      console.log('');
    });

    if (results.results.length > 5) {
      console.log(`... and ${results.results.length - 5} more results\n`);
    }

    // Save to JSON file
    const filename = `results-vitrum-${Date.now()}.json`;
    const { writeFileSync } = await import('fs');
    writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${filename}`);

  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
