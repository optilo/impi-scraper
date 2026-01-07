#!/usr/bin/env tsx
/**
 * IMPI Scraper CLI
 *
 * Usage:
 *   pnpm run search <keyword>           # Basic keyword search
 *   tsx cli.ts search <keyword> --full    # Search with full details
 *   tsx cli.ts details <impi-id>          # Get details for specific trademark
 *
 * Options:
 *   --full, -f          Fetch full details (owners, classes, history)
 *   --output, -o        Output file path (default: stdout as JSON)
 *   --visible, -v       Show browser (non-headless mode)
 *   --no-human          Disable human-like behavior (faster)
 *   --limit, -l         Limit number of results to process
 *   --help, -h          Show this help message
 *
 * Examples:
 *   pnpm run search vitrum
 *   tsx cli.ts search "coca cola" --full -o results.json
 *   tsx cli.ts search nike --limit 5 --visible
 */

// Load .env file (Node.js doesn't auto-load like Bun)
import 'dotenv/config';

import { parseArgs } from 'util';
import { IMPIApiClient, IMPIConcurrentPool, generateSessionTokens, generateSearch, generateBatchSearch, countTrademarks, searchByUrl, parseIMPISearchUrl } from './src/index.ts';
import { parseProxyUrl } from './src/utils/proxy.ts';
import { fetchProxiesFromEnv, fetchProxies, parseProxyProviderFromEnv } from './src/utils/proxy-provider.ts';
import type { SearchResults, ProxyConfig } from './src/types.ts';

const HELP = `
IMPI Trademark Scraper CLI

USAGE:
  pnpm run search <keyword> [options]
  tsx cli.ts search-url <url>              # Scrape ALL results from an IMPI search URL
  tsx cli.ts search-many <keyword1> <keyword2> ... [options]
  tsx cli.ts generate-search <keyword>     # For serverless/queue workflows
  tsx cli.ts generate-batch <q1> <q2> ...  # Batch generation (one browser session)
  tsx cli.ts generate-tokens               # Generate session tokens only
  tsx cli.ts count <keyword>               # Fast count only (no records fetched)
  tsx cli.ts fetch-proxies [count]

COMMANDS:
  search <keyword>         Search trademarks by keyword
  search-url <url>         Scrape ALL results from an IMPI search URL (with filters pre-applied)
  search-many <keywords>   Search multiple keywords concurrently (with proxies)
  generate-search <query>  Generate tokens + searchId for serverless (outputs JSON)
  generate-batch <queries> Generate tokens + searchIds for multiple queries (one browser session)
  generate-tokens          Generate session tokens only (outputs JSON)
  count <keyword>          Return only the total result count for a keyword
  fetch-proxies            Fetch fresh proxy IPs from configured provider (IPFoxy)

OPTIONS:
  --full, -f          Fetch full details (owners, classes, history)
  --output, -o FILE   Output to JSON file (default: prints to stdout)
  --visible, -v       Show browser window (forces browser mode)
  --browser           Force full browser mode (slower, more robust)
  --human             Enable human-like behavior (slower but less detectable)
  --limit, -l NUM     Limit results to process
  --format FORMAT     Output format: json, table, summary (default: json)
  --proxy [URL]       Use proxy. Without URL: auto-fetch from IPFoxy. With URL: use that proxy
  --concurrency, -c   Number of concurrent workers (default: 1, requires IPFOXY_API_TOKEN)
  --debug, -d         Save screenshots on CAPTCHA/blocking detection (to ./screenshots)
  --rate-limit NUM    API rate limit in ms (default: 100 = 10 req/sec)
  --delay NUM         Delay between batch searches in ms (default: 500)
  --help, -h          Show this help

ENVIRONMENT VARIABLES:
  IMPI_PROXY_URL      Proxy URL (alternative to --proxy flag)
  PROXY_URL           Proxy URL (fallback)
  HTTP_PROXY          Proxy URL (fallback)
  IPFOXY_API_TOKEN    IPFoxy API token for concurrent proxy rotation

EXAMPLES:
  # Basic search
  pnpm run search vitrum

  # Full details with output file
  tsx cli.ts search "coca cola" --full -o coca-cola.json

  # Quick search with visible browser, limited results
  tsx cli.ts search nike --visible --limit 5

  # Table format output
  tsx cli.ts search vitrum --format table

  # Search with auto-fetched proxy (requires IPFOXY_API_TOKEN)
  tsx cli.ts search vitrum --proxy

  # Search with explicit proxy URL
  tsx cli.ts search vitrum --proxy http://user:pass@proxy.example.com:8080

  # Concurrent search with multiple proxies (requires IPFOXY_API_TOKEN)
  tsx cli.ts search-many nike adidas puma --concurrency 3

  # Debug mode (saves screenshots on CAPTCHA/blocking)
  tsx cli.ts search vitrum --debug --visible

URL SEARCH (with pre-applied filters):
  # Scrape ALL results from an IMPI search URL
  tsx cli.ts search-url "https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l"

  # With output file and full details
  tsx cli.ts search-url "https://marcia.impi.gob.mx/marcas/search/result?s=UUID" --full -o results.json

SERVERLESS/QUEUE WORKFLOW:
  # Generate tokens + searchId locally, then process in serverless
  tsx cli.ts generate-search nike -o nike-search.json

  # Generate tokens only (reuse for multiple searches)
  tsx cli.ts generate-tokens -o tokens.json

  # Batch generation (one browser session for multiple queries - most efficient!)
  tsx cli.ts generate-batch nike adidas puma -o batch.json --delay 500

  # In your Trigger.dev/Vercel function:
  # const client = new IMPIHttpClient(payload.tokens);
  # const results = await client.fetchAllResults(payload.searchId, payload.totalResults);
`;

interface CLIOptions {
  full: boolean;
  output?: string;
  visible: boolean;
  browser: boolean;
  human: boolean;
  limit?: number;
  format: 'json' | 'table' | 'summary';
  proxy?: string;
  autoProxy: boolean; // --proxy without URL = auto-fetch from IPFoxy
  concurrency: number;
  debug: boolean;
  rateLimit: number;
  delay: number; // Delay between batch searches in ms
  help: boolean;
}

async function runCount(keyword: string, options: CLIOptions): Promise<void> {
  console.error(`Counting IMPI results for "${keyword}"...`);

  // Resolve proxy (reuse same logic as search)
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  try {
    const count = await countTrademarks(keyword, {
      headless: true,
      humanBehavior: options.human,
      proxy,
      apiRateLimitMs: options.rateLimit,
      debug: options.debug,
    });

    console.log(JSON.stringify({ query: keyword, count }, null, 2));
    console.error(`Done! Count: ${count}`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

function parseCliArgs(): { command: string; keywords: string[]; options: CLIOptions } {
  const rawArgs = process.argv.slice(2);

  // Detect --proxy or -p without a URL value (for auto-fetch)
  // We need to check if --proxy/−p appears and the next arg is missing or is another flag
  let autoProxy = false;
  const processedArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    const nextArg = rawArgs[i + 1];

    if (arg === '--proxy' || arg === '-p') {
      // Check if next arg is missing or is another flag (starts with -)
      if (!nextArg || nextArg.startsWith('-')) {
        autoProxy = true;
        // Skip this arg - don't pass --proxy to parseArgs
        continue;
      }
    }
    processedArgs.push(arg);
  }

  const { values, positionals } = parseArgs({
    args: processedArgs,
    options: {
      full: { type: 'boolean', short: 'f', default: false },
      output: { type: 'string', short: 'o' },
      visible: { type: 'boolean', short: 'v', default: false },
      browser: { type: 'boolean', default: false },
      human: { type: 'boolean', default: true },
      limit: { type: 'string', short: 'l' },
      format: { type: 'string', default: 'json' },
      proxy: { type: 'string', short: 'p' },
      concurrency: { type: 'string', short: 'c' },
      debug: { type: 'boolean', short: 'd', default: false },
      'rate-limit': { type: 'string', short: 'r' },
      delay: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  const command = positionals[0] || '';
  const keywords = positionals.slice(1);

  return {
    command,
    keywords,
    options: {
      full: values.full as boolean,
      output: values.output as string | undefined,
      visible: values.visible as boolean,
      browser: values.browser as boolean,
      human: values.human as boolean,
      limit: values.limit ? parseInt(values.limit as string, 10) : undefined,
      format: (values.format as 'json' | 'table' | 'summary') || 'json',
      proxy: values.proxy as string | undefined,
      autoProxy,
      concurrency: values.concurrency ? parseInt(values.concurrency as string, 10) : 1,
      debug: values.debug as boolean,
      rateLimit: values['rate-limit'] ? parseInt(values['rate-limit'] as string, 10) : 0,
      delay: values.delay ? parseInt(values.delay as string, 10) : 500,
      help: values.help as boolean,
    },
  };
}

function formatTable(results: SearchResults): string {
  const lines: string[] = [];
  const divider = '-'.repeat(100);

  lines.push(divider);
  lines.push(`Query: "${results.metadata.query}" | Found: ${results.metadata.totalResults} | Processed: ${results.results.length}`);
  lines.push(`Duration: ${(results.performance.durationMs / 1000).toFixed(2)}s | IP: ${results.metadata.externalIp || 'N/A'}`);
  lines.push(divider);

  lines.push(
    'Title'.padEnd(30) +
    'Status'.padEnd(15) +
    'App #'.padEnd(12) +
    'Reg #'.padEnd(12) +
    'IMPI ID'.padEnd(20)
  );
  lines.push(divider);

  for (const tm of results.results) {
    lines.push(
      (tm.title || '').substring(0, 28).padEnd(30) +
      (tm.status || '').substring(0, 13).padEnd(15) +
      (tm.applicationNumber || '').padEnd(12) +
      (tm.registrationNumber || 'N/A').padEnd(12) +
      tm.impiId
    );
  }

  lines.push(divider);
  return lines.join('\n');
}

function formatSummary(results: SearchResults): string {
  const lines: string[] = [];

  lines.push(`\n=== IMPI Search Results ===\n`);
  lines.push(`Query:      "${results.metadata.query}"`);
  lines.push(`Total:      ${results.metadata.totalResults} trademarks found`);
  lines.push(`Processed:  ${results.results.length} results`);
  lines.push(`Duration:   ${(results.performance.durationMs / 1000).toFixed(2)} seconds`);
  lines.push(`External IP: ${results.metadata.externalIp || 'N/A'}`);
  lines.push(`Search ID:  ${results.metadata.searchId || 'N/A'}`);
  lines.push('');

  if (results.results.length > 0) {
    lines.push('--- Top Results ---\n');

    results.results.slice(0, 10).forEach((tm, i) => {
      lines.push(`${i + 1}. ${tm.title}`);
      lines.push(`   ID: ${tm.impiId}`);
      lines.push(`   Status: ${tm.status}`);
      lines.push(`   Application: ${tm.applicationNumber} (${tm.applicationDate || 'N/A'})`);
      lines.push(`   Registration: ${tm.registrationNumber || 'N/A'}`);

      if (tm.ownerName) {
        lines.push(`   Owner: ${tm.ownerName}`);
      }

      if (tm.classes && tm.classes.length > 0) {
        lines.push(`   Classes: ${tm.classes.map(c => c.classNumber).join(', ')}`);
      }

      lines.push('');
    });

    if (results.results.length > 10) {
      lines.push(`... and ${results.results.length - 10} more results`);
    }
  }

  return lines.join('\n');
}

async function runSearch(keyword: string, options: CLIOptions): Promise<void> {
  // Use browser mode if --visible or --browser flag is set
  const useBrowserMode = options.visible || options.browser;
  const mode = useBrowserMode ? 'browser' : 'api';

  console.error(`Searching IMPI for "${keyword}"...`);
  console.error(`Mode: ${mode} | Details: ${options.full ? 'full' : 'basic'}${useBrowserMode ? ` | Browser: ${options.visible ? 'visible' : 'headless'}` : ''} | Human: ${options.human ? 'on' : 'off'}${options.debug ? ' | Debug: ON' : ''}`);

  // Resolve proxy: explicit URL > auto-fetch > env > none
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    // Explicit proxy URL provided
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    // Auto-fetch from IPFoxy
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      console.error('Either set IPFOXY_API_TOKEN or provide a proxy URL: --proxy http://user:pass@host:port');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    console.error(`Proxy: from env or none`);
  }
  // no client-side rate limit output
  if (options.debug) {
    console.error(`Screenshots will be saved to ./screenshots on errors`);
  }
  console.error('');

  let results: SearchResults;

  if (useBrowserMode) {
    // Visible browser mode (still uses IMPIApiClient but with visible browser)
    const client = new IMPIApiClient({
      headless: !options.visible,
      detailLevel: options.full ? 'full' : 'basic',
      humanBehavior: options.human,
      apiRateLimitMs: options.rateLimit,
      maxResults: options.limit || 0,
      proxy,
      debug: options.debug,
      keepBrowserOpen: true, // Keep browser open for visible mode
    });
    try {
      results = await client.search(keyword);
    } finally {
      await client.close();
    }
  } else {
    // API mode (default - faster)
    const client = new IMPIApiClient({
      headless: true,
      detailLevel: options.full ? 'full' : 'basic',
      humanBehavior: options.human,
      apiRateLimitMs: options.rateLimit,
      maxResults: options.limit || 0,
      proxy,
      debug: options.debug,
    });
    try {
      results = await client.search(keyword);
    } finally {
      await client.close();
    }
  }

  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    results.results = results.results.slice(0, options.limit);
  }

  // Format output
  let output: string;
  switch (options.format) {
    case 'table':
      output = formatTable(results);
      break;
    case 'summary':
      output = formatSummary(results);
      break;
    case 'json':
    default:
      output = JSON.stringify(results, null, 2);
  }

  // Output to file or stdout
  if (options.output) {
    const { writeFileSync } = await import('fs');
    writeFileSync(options.output, output);
    console.error(`Results saved to: ${options.output}`);
  } else {
    console.log(output);
  }

  console.error(`\nDone! Found ${results.metadata.totalResults} results, processed ${results.results.length}`);
  if (results.metadata.externalIp) {
    console.error(`External IP used: ${results.metadata.externalIp}`);
  }
}

async function runConcurrentSearch(keywords: string[], options: CLIOptions): Promise<void> {
  const concurrency = options.concurrency;

  console.error(`Concurrent search for ${keywords.length} keywords with ${concurrency} workers...`);
  console.error(`Keywords: ${keywords.join(', ')}`);
  console.error(`Details: ${options.full ? 'full' : 'basic'}`);


  // Fetch proxies from provider (one per worker)
  const providerConfig = parseProxyProviderFromEnv();
  let proxies: ProxyConfig[] = [];

  if (providerConfig) {
    console.error(`Fetching ${concurrency} proxies from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, concurrency);
      proxies = result.proxies;
      console.error(`✓ Got ${proxies.length} proxies`);
    } catch (err) {
      console.error(`⚠ Failed to fetch proxies: ${(err as Error).message}`);
      console.error('  Falling back to no proxy (all workers share same IP)');
    }
  } else {
    console.error('⚠ No proxy provider configured (IPFOXY_API_TOKEN not set)');
    console.error('  All workers will share the same IP');
  }

  console.error('');

  // Create concurrent pool
  const pool = new IMPIConcurrentPool({
    concurrency,
    proxies,
    detailLevel: options.full ? 'full' : 'basic',
    humanBehavior: options.human,
    apiRateLimitMs: options.rateLimit,
    maxResults: options.limit || 0,
    debug: options.debug,
  });

  try {
    const startTime = Date.now();
    const results = await pool.searchMany(keywords);
    const duration = Date.now() - startTime;

    // Aggregate stats
    const successful = results.filter(r => r.results !== null);
    const failed = results.filter(r => r.error);
    const totalResults = successful.reduce((sum, r) => sum + (r.results?.metadata.totalResults || 0), 0);
    const totalProcessed = successful.reduce((sum, r) => sum + (r.results?.results.length || 0), 0);

    console.error(`\n${'═'.repeat(60)}`);
    console.error(`Concurrent Search Complete`);
    console.error(`${'═'.repeat(60)}`);
    console.error(`Keywords searched: ${keywords.length}`);
    console.error(`Successful:        ${successful.length}`);
    console.error(`Failed:            ${failed.length}`);
    console.error(`Total results:     ${totalResults}`);
    console.error(`Total processed:   ${totalProcessed}`);
    console.error(`Duration:          ${(duration / 1000).toFixed(2)}s`);
    console.error(`Throughput:        ${(keywords.length / (duration / 1000)).toFixed(2)} queries/sec`);
    console.error(`${'═'.repeat(60)}`);

    // Show per-query summary
    console.error(`\nPer-query results:`);
    for (const r of results) {
      if (r.results) {
        console.error(`  ✓ "${r.query}": ${r.results.metadata.totalResults} found, ${r.results.results.length} processed (worker ${r.workerId}${r.proxyUsed ? `, proxy: ${r.proxyUsed}` : ''})`);
      } else {
        console.error(`  ✗ "${r.query}": ${r.error?.message || 'unknown error'} (worker ${r.workerId})`);
      }
    }

    // Output results
    const output = JSON.stringify({
      summary: {
        keywords: keywords.length,
        successful: successful.length,
        failed: failed.length,
        totalResults,
        totalProcessed,
        durationMs: duration,
      },
      results: results.map(r => ({
        query: r.query,
        workerId: r.workerId,
        proxyUsed: r.proxyUsed,
        success: r.results !== null,
        error: r.error?.message,
        data: r.results,
      })),
    }, null, 2);

    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, output);
      console.error(`\nResults saved to: ${options.output}`);
    } else {
      console.log(output);
    }
  } finally {
    await pool.close();
  }
}

async function runGenerateTokens(options: CLIOptions): Promise<void> {
  console.error('Generating session tokens...');
  console.error(`Visible browser: ${options.visible}`);
  console.error('');

  // Resolve proxy if specified
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  console.error('');

  try {
    const tokens = await generateSessionTokens({
      headless: !options.visible,
      proxy,
      humanBehavior: options.human,
    });

    const output = JSON.stringify(tokens, null, 2);

    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, output);
      console.error(`✅ Tokens saved to: ${options.output}`);
    } else {
      console.log(output);
    }

    if (tokens.expiresAt) {
      const expiresIn = Math.round((tokens.expiresAt - Date.now()) / 1000 / 60);
      console.error(`\nTokens expire in ~${expiresIn} minutes`);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function runGenerateSearch(keyword: string, options: CLIOptions): Promise<void> {
  console.error(`Generating search for: "${keyword}"`);
  console.error(`Visible browser: ${options.visible}`);
  console.error('');

  // Resolve proxy if specified
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  console.error('');

  try {
    const search = await generateSearch(keyword, {
      headless: !options.visible,
      proxy,
      humanBehavior: options.human,
    });

    const output = JSON.stringify(search, null, 2);

    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, output);
      console.error(`✅ Search data saved to: ${options.output}`);
    } else {
      console.log(output);
    }

    console.error(`\n📊 Search Summary:`);
    console.error(`   Query: "${search.query}"`);
    console.error(`   SearchId: ${search.searchId}`);
    console.error(`   Total Results: ${search.totalResults}`);
    if (search.tokens.expiresAt) {
      const expiresIn = Math.round((search.tokens.expiresAt - Date.now()) / 1000 / 60);
      console.error(`   Tokens expire in: ~${expiresIn} minutes`);
    }
    console.error(`\n💡 Use this data with IMPIHttpClient in your serverless function.`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function runGenerateBatch(queries: string[], options: CLIOptions): Promise<void> {
  console.error(`Generating batch search for ${queries.length} queries...`);
  console.error(`Queries: ${queries.join(', ')}`);
  console.error(`Visible browser: ${options.visible}`);
  console.error(`Delay between searches: ${options.delay}ms`);
  console.error('');

  // Resolve proxy if specified
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  console.error('');

  try {
    const batch = await generateBatchSearch(queries, {
      headless: !options.visible,
      proxy,
      humanBehavior: options.human,
      delayBetweenSearchesMs: options.delay,
    });

    const output = JSON.stringify(batch, null, 2);

    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, output);
      console.error(`✅ Batch data saved to: ${options.output}`);
    } else {
      console.log(output);
    }

    console.error(`\n📊 Batch Summary:`);
    console.error(`   Total queries: ${batch.summary.total}`);
    console.error(`   Successful: ${batch.summary.successful}`);
    console.error(`   Failed: ${batch.summary.failed}`);
    console.error(`   Duration: ${(batch.summary.durationMs / 1000).toFixed(2)}s`);

    if (batch.searches.length > 0) {
      console.error(`\n   Searches:`);
      for (const search of batch.searches) {
        console.error(`   ✓ "${search.query}": ${search.totalResults} results (searchId: ${search.searchId.substring(0, 8)}...)`);
      }
    }

    if (batch.errors.length > 0) {
      console.error(`\n   Errors:`);
      for (const err of batch.errors) {
        console.error(`   ✗ "${err.query}": ${err.error}`);
      }
    }

    if (batch.tokens.expiresAt) {
      const expiresIn = Math.round((batch.tokens.expiresAt - Date.now()) / 1000 / 60);
      console.error(`\n   Tokens expire in: ~${expiresIn} minutes`);
    }

    console.error(`\n💡 Use batch.tokens with IMPIHttpClient for each search in serverless.`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function runSearchByUrl(url: string, options: CLIOptions): Promise<void> {
  console.error(`Searching IMPI by URL...`);
  console.error(`URL: ${url}`);
  console.error(`Details: ${options.full ? 'full' : 'basic'} | Human: ${options.human ? 'on' : 'off'}${options.debug ? ' | Debug: ON' : ''}`);

  // Validate URL
  const searchId = parseIMPISearchUrl(url);
  if (!searchId) {
    console.error('Error: Invalid IMPI search URL');
    console.error('Expected format: https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l');
    process.exit(1);
  }
  console.error(`Search ID: ${searchId}`);

  // Resolve proxy: explicit URL > auto-fetch > env > none
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else if (options.autoProxy) {
    const providerConfig = parseProxyProviderFromEnv();
    if (!providerConfig) {
      console.error('Error: --proxy requires IPFOXY_API_TOKEN to be set for auto-fetch');
      console.error('Either set IPFOXY_API_TOKEN or provide a proxy URL: --proxy http://user:pass@host:port');
      process.exit(1);
    }
    console.error(`Fetching proxy from ${providerConfig.provider}...`);
    try {
      const result = await fetchProxies(providerConfig, 1);
      if (result.proxies.length === 0) {
        throw new Error('No proxies returned');
      }
      proxy = result.proxies[0];
      console.error(`Proxy: ${proxy!.server} (auto-fetched)`);
    } catch (err) {
      console.error(`Error fetching proxy: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    console.error(`Proxy: from env or none`);
  }
  console.error('');

  try {
    const results = await searchByUrl(url, {
      headless: true,
      detailLevel: options.full ? 'full' : 'basic',
      humanBehavior: options.human,
      apiRateLimitMs: options.rateLimit,
      maxResults: options.limit || 0,
      proxy,
      debug: options.debug,
    });

    // Format output
    let output: string;
    switch (options.format) {
      case 'table':
        output = formatTable(results);
        break;
      case 'summary':
        output = formatSummary(results);
        break;
      case 'json':
      default:
        output = JSON.stringify(results, null, 2);
    }

    // Output to file or stdout
    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, output);
      console.error(`Results saved to: ${options.output}`);
    } else {
      console.log(output);
    }

    console.error(`\nDone! Found ${results.metadata.totalResults} results, processed ${results.results.length}`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { command, keywords, options } = parseCliArgs();

  if (options.help || !command) {
    console.log(HELP);
    process.exit(0);
  }

  if (command === 'fetch-proxies') {
    const count = keywords[0] ? parseInt(keywords[0], 10) : 1;
    await runFetchProxies(count);
    return;
  }

  if (command === 'generate-tokens') {
    await runGenerateTokens(options);
    return;
  }

  if (command === 'count') {
    const keyword = keywords.join(' ');
    if (!keyword) {
      console.error('Error: keyword is required');
      console.error('Usage: tsx cli.ts count <keyword>');
      process.exit(1);
    }
    await runCount(keyword, options);
    return;
  }

  if (command === 'generate-search') {
    const keyword = keywords.join(' ');
    if (!keyword) {
      console.error('Error: keyword is required');
      console.error('Usage: tsx cli.ts generate-search <keyword>');
      process.exit(1);
    }
    await runGenerateSearch(keyword, options);
    return;
  }

  if (command === 'generate-batch') {
    if (keywords.length === 0) {
      console.error('Error: at least one query is required');
      console.error('Usage: tsx cli.ts generate-batch <query1> <query2> ... [options]');
      process.exit(1);
    }
    await runGenerateBatch(keywords, options);
    return;
  }

  if (command === 'search-url') {
    const url = keywords.join(' ');
    if (!url) {
      console.error('Error: URL is required');
      console.error('Usage: tsx cli.ts search-url <url>');
      console.error('Example: tsx cli.ts search-url "https://marcia.impi.gob.mx/marcas/search/result?s=UUID&m=l"');
      process.exit(1);
    }
    try {
      await runSearchByUrl(url, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'search-many') {
    if (keywords.length === 0) {
      console.error('Error: at least one keyword is required');
      console.error('Usage: tsx cli.ts search-many <keyword1> <keyword2> ...');
      process.exit(1);
    }
    try {
      await runConcurrentSearch(keywords, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command !== 'search') {
    console.error(`Unknown command: ${command}`);
    console.error('Use --help for usage information');
    process.exit(1);
  }

  const keyword = keywords.join(' ');
  if (!keyword) {
    console.error('Error: keyword is required');
    console.error('Usage: pnpm run search <keyword> or tsx cli.ts search <keyword>');
    process.exit(1);
  }

  try {
    await runSearch(keyword, options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function runFetchProxies(count: number): Promise<void> {
  const providerConfig = parseProxyProviderFromEnv();

  if (!providerConfig) {
    console.error('Error: No proxy provider configured');
    console.error('Set IPFOXY_API_TOKEN environment variable');
    console.error('See .env.example for configuration options');
    process.exit(1);
  }

  console.log(`Fetching ${count} proxy(ies) from ${providerConfig.provider}...`);
  console.log(`  Host: ${providerConfig.host || 'default'}`);
  console.log(`  Port: ${providerConfig.port || 'default'}`);
  console.log('');

  try {
    const result = await fetchProxiesFromEnv(count);

    if (!result || result.count === 0) {
      console.error('❌ No proxies returned from provider');
      process.exit(1);
    }

    console.log(`✅ Fetched ${result.count} proxy(ies):\n`);

    for (let i = 0; i < result.proxies.length; i++) {
      const proxy = result.proxies[i]!;
      console.log(`Proxy ${i + 1}:`);
      console.log(`  Server: ${proxy.server}`);
      if (proxy.username) {
        console.log(`  Username: ${proxy.username}`);
      }
      console.log('');
    }

    // Output as JSON for scripting
    if (count > 1) {
      console.log('JSON output:');
      console.log(JSON.stringify(result.proxies, null, 2));
    }
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  }
}

main().then(() => {
  // Explicitly exit to ensure all Camoufox subprocess resources are released
  process.exit(0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
