/**
 * Example: Full detail search with owner and class information
 * Demonstrates advanced usage with complete trademark details
 *
 * Run with: bun examples/full-details.ts
 */

import { IMPIScraper } from '../src/index';

async function main() {
  const keyword = process.argv[2] || 'nike';

  console.log(`Performing full detail search for "${keyword}"...\n`);

  const scraper = new IMPIScraper({
    detailLevel: 'full',   // Get complete details
    headless: true,
    rateLimitMs: 2500,     // Be more conservative with full details
    maxRetries: 3,
    humanBehavior: true
  });

  try {
    const results = await scraper.search(keyword);

    console.log('Search completed!\n');
    console.log(`Found ${results.results.length} trademarks\n`);

    // Display first result with full details
    const firstResult = results.results[0];
    if (firstResult) {
      console.log('=== First Result (Full Details) ===\n');
      console.log('Basic Info:');
      console.log(`  Title: ${firstResult.title}`);
      console.log(`  ID: ${firstResult.impiId}`);
      console.log(`  Status: ${firstResult.status}`);
      console.log(`  Type: ${firstResult.appType}`);

      console.log('\nOwner Information:');
      if (firstResult.owners && firstResult.owners.length > 0) {
        firstResult.owners.forEach((owner, i) => {
          console.log(`  ${i + 1}. ${owner.name}`);
          console.log(`     Country: ${owner.country || 'N/A'}`);
          console.log(`     Address: ${owner.address || 'N/A'}`);
        });
      }

      console.log('\nClasses:');
      if (firstResult.classes && firstResult.classes.length > 0) {
        firstResult.classes.forEach(cls => {
          console.log(`  - Class ${cls.classNumber}: ${cls.goodsAndServices?.substring(0, 100)}...`);
        });
      }

      console.log('\nDates:');
      console.log(`  Application: ${firstResult.applicationDate || 'N/A'}`);
      console.log(`  Registration: ${firstResult.registrationDate || 'N/A'}`);
      console.log(`  Expiry: ${firstResult.expiryDate || 'N/A'}`);

      console.log('\nHistory Records:');
      if (firstResult.history && firstResult.history.length > 0) {
        console.log(`  Total records: ${firstResult.history.length}`);
        firstResult.history.slice(0, 3).forEach((hist, i) => {
          console.log(`  ${i + 1}. ${hist.description}`);
          console.log(`     Date: ${hist.startDate || 'N/A'}`);
        });
      }
    }

    // Save results
    const filename = `results-${keyword}-full-${Date.now()}.json`;
    await Bun.write(filename, JSON.stringify(results, null, 2));
    console.log(`\nFull results saved to: ${filename}`);

  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
