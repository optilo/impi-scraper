#!/usr/bin/env bun
/**
 * IMPI Scraper CLI
 *
 * Usage:
 *   bun cli.ts search <keyword>           # Basic keyword search
 *   bun cli.ts search <keyword> --full    # Search with full details
 *   bun cli.ts details <impi-id>          # Get details for specific trademark
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
 *   bun cli.ts search vitrum
 *   bun cli.ts search "coca cola" --full -o results.json
 *   bun cli.ts search nike --limit 5 --visible
 */

import { parseArgs } from 'util';
import { IMPIScraper } from './src/index';
import { parseProxyUrl } from './src/utils/proxy';
import type { SearchResults, ProxyConfig } from './src/types';

const HELP = `
IMPI Trademark Scraper CLI

USAGE:
  bun cli.ts search <keyword> [options]

COMMANDS:
  search <keyword>    Search trademarks by keyword

OPTIONS:
  --full, -f          Fetch full details (owners, classes, history)
  --output, -o FILE   Output to JSON file (default: prints to stdout)
  --visible, -v       Show browser window
  --human             Enable human-like behavior (slower but less detectable)
  --limit, -l NUM     Limit results to process
  --format FORMAT     Output format: json, table, summary (default: json)
  --proxy URL         Proxy server URL (e.g., http://user:pass@host:port)
  --help, -h          Show this help

ENVIRONMENT VARIABLES:
  IMPI_PROXY_URL      Proxy URL (alternative to --proxy flag)
  PROXY_URL           Proxy URL (fallback)
  HTTP_PROXY          Proxy URL (fallback)

EXAMPLES:
  # Basic search
  bun cli.ts search vitrum

  # Full details with output file
  bun cli.ts search "coca cola" --full -o coca-cola.json

  # Quick search with visible browser, limited results
  bun cli.ts search nike --visible --limit 5

  # Table format output
  bun cli.ts search vitrum --format table

  # Search with proxy
  bun cli.ts search vitrum --proxy http://user:pass@proxy.example.com:8080

  # Using environment variable for proxy
  IMPI_PROXY_URL=http://proxy:8080 bun cli.ts search vitrum
`;

interface CLIOptions {
  full: boolean;
  output?: string;
  visible: boolean;
  human: boolean;
  limit?: number;
  format: 'json' | 'table' | 'summary';
  proxy?: string;
  help: boolean;
}

function parseCliArgs(): { command: string; keyword: string; options: CLIOptions } {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      full: { type: 'boolean', short: 'f', default: false },
      output: { type: 'string', short: 'o' },
      visible: { type: 'boolean', short: 'v', default: false },
      human: { type: 'boolean', default: false },
      limit: { type: 'string', short: 'l' },
      format: { type: 'string', default: 'json' },
      proxy: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  const command = positionals[0] || '';
  const keyword = positionals.slice(1).join(' ');

  return {
    command,
    keyword,
    options: {
      full: values.full as boolean,
      output: values.output as string | undefined,
      visible: values.visible as boolean,
      human: values.human as boolean,
      limit: values.limit ? parseInt(values.limit as string, 10) : undefined,
      format: (values.format as 'json' | 'table' | 'summary') || 'json',
      proxy: values.proxy as string | undefined,
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
  console.error(`Searching IMPI for "${keyword}"...`);
  console.error(`Mode: ${options.full ? 'full details' : 'basic'} | Browser: ${options.visible ? 'visible' : 'headless'} | Human behavior: ${options.human ? 'on' : 'off'}`);

  // Parse proxy from CLI flag if provided
  let proxy: ProxyConfig | undefined;
  if (options.proxy) {
    proxy = parseProxyUrl(options.proxy);
    console.error(`Proxy: ${proxy.server}`);
  } else {
    console.error(`Proxy: from env or none`);
  }
  console.error('');

  const scraper = new IMPIScraper({
    headless: !options.visible,
    detailLevel: options.full ? 'full' : 'basic',
    humanBehavior: options.human,
    rateLimitMs: options.full ? 2500 : 2000,
    proxy,
  });

  const results = await scraper.search(keyword);

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
    await Bun.write(options.output, output);
    console.error(`Results saved to: ${options.output}`);
  } else {
    console.log(output);
  }

  console.error(`\nDone! Found ${results.metadata.totalResults} results, processed ${results.results.length}`);
  if (results.metadata.externalIp) {
    console.error(`External IP used: ${results.metadata.externalIp}`);
  }
}

async function main(): Promise<void> {
  const { command, keyword, options } = parseCliArgs();

  if (options.help || !command) {
    console.log(HELP);
    process.exit(0);
  }

  if (command !== 'search') {
    console.error(`Unknown command: ${command}`);
    console.error('Use --help for usage information');
    process.exit(1);
  }

  if (!keyword) {
    console.error('Error: keyword is required');
    console.error('Usage: bun cli.ts search <keyword>');
    process.exit(1);
  }

  try {
    await runSearch(keyword, options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
