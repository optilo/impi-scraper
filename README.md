# IMPI Trademark Scraper

A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial) - the Mexican trademark office. Uses Camoufox (headless Firefox with anti-detection) for session tokens, then direct API calls for data fetching.

## Features

- **API-Only Mode**: Fast direct API calls after session token extraction (10-50x faster than browser scraping)
- **Camoufox Anti-Detection**: Uses Camoufox (Firefox with anti-detection) for initial session only
- **Keyword Search**: Search trademarks by keyword
- **Concurrent Search**: Multiple workers with per-worker proxy rotation
- **Human-like Behavior**: Simulates real user interactions (mouse movements, typing delays, scrolling)
- **Proxy Support**: Route requests through HTTP/SOCKS proxies for IP rotation
- **IPFoxy Integration**: Built-in support for [IPFoxy](https://www.ipfoxy.com/) rotating proxy API
- **Full Details**: Option to fetch complete trademark information including owners, classes, and history
- **CLI Interface**: Easy command-line access with multiple output formats
- **TypeScript**: Fully typed with comprehensive type definitions

## Requirements

- Node.js 22.x

## Installation

```bash
# Install dependencies
pnpm install

# Download Camoufox browser (first time only)
pnpm exec camoufox-js fetch
```

## CLI Usage

The easiest way to use the scraper:

```bash
# Basic keyword search (runs tsx once, no watcher)
pnpm run search vitrum

# Search with full details (owners, classes, history)
tsx cli.ts search vitrum --full

# Output to file
tsx cli.ts search "coca cola" -o results.json

# Table format output
tsx cli.ts search nike --format table

# Summary format
tsx cli.ts search nike --format summary

# Show browser window (useful for debugging)
tsx cli.ts search vitrum --visible

# Enable human-like behavior (slower but less detectable)
tsx cli.ts search vitrum --human

# Limit results
tsx cli.ts search nike --limit 5

# Search with proxy
tsx cli.ts search vitrum --proxy http://user:pass@proxy.example.com:8080

# Using environment variable for proxy
IMPI_PROXY_URL=http://proxy:8080 tsx cli.ts search vitrum

# Count only (no records fetched)
pnpm run count pacific

# Node-only fallback (no tsx)
pnpm run count:node pacific

# Quick count endpoint
# Uses https://marcia.impi.gob.mx/marcas/search/internal/result/count
# Requires a valid session (handled automatically)
```

### CLI Commands

```bash
# Search trademarks (single keyword)
pnpm run search <keyword> [options]
# or
tsx cli.ts search <keyword> [options]

# Concurrent search (multiple keywords with multiple proxies)
tsx cli.ts search-many <keyword1> <keyword2> ... [options]

# Fetch fresh proxies from IPFoxy
tsx cli.ts fetch-proxies [count]
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--full` | `-f` | Fetch full details (owners, classes, history) |
| `--output FILE` | `-o` | Output to JSON file |
| `--visible` | `-v` | Show browser window |
| `--human` | | Enable human-like behavior (slower) |
| `--limit NUM` | `-l` | Limit number of results |
| `--format` | | Output format: json, table, summary |
| `--proxy URL` | `-p` | Proxy server URL |
| `--concurrency NUM` | `-c` | Number of concurrent workers (default: 1) |
| `--rate-limit NUM` | | (deprecated) |
| `--debug` | `-d` | Save screenshots on CAPTCHA/blocking detection |
| `--help` | `-h` | Show help |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `IPFOXY_API_TOKEN` | IPFoxy API token for dynamic proxy fetching |
| `IMPI_PROXY_URL` | Static proxy URL (highest priority) |
| `PROXY_URL` | Static proxy URL (fallback) |
| `HTTP_PROXY` | Static proxy URL (fallback) |
| `HTTPS_PROXY` | Static proxy URL (fallback) |

See `.env.example` for detailed configuration options.

### Output Formats

**JSON** (default): Full structured data
```bash
pnpm run search vitrum
```

**Table**: Quick overview in terminal
```bash
pnpm run search vitrum --format table
```

**Summary**: Human-readable summary
```bash
pnpm run search vitrum --format summary
```

## Concurrent Search

For high-volume searches, use `search-many` with multiple workers. Each worker gets its own proxy from IPFoxy:

```bash
# Search 5 keywords with 3 concurrent workers (fetches 3 proxies automatically)
tsx cli.ts search-many nike adidas puma reebok converse --concurrency 3

# With full details
tsx cli.ts search-many nike adidas puma --concurrency 3 --full -o results.json
```

**Requirements:**
- Set `IPFOXY_API_TOKEN` environment variable for proxy rotation
- Each worker gets a unique IP from IPFoxy

**How it works:**
1. Fetches N proxies from IPFoxy (where N = concurrency)
2. Initializes N browser sessions in parallel (one per proxy/IP)
3. Distributes keywords across workers
4. Returns aggregated results with per-query stats

### Programmatic Concurrent Search

```typescript
import { IMPIConcurrentPool } from '@optilo/impi-scraper';
import { fetchProxiesFromEnv } from '@optilo/impi-scraper';

// Fetch 3 proxies (3 different IPs)
const proxyResult = await fetchProxiesFromEnv(3);

const pool = new IMPIConcurrentPool({
  concurrency: 3,
  proxies: proxyResult?.proxies || [],
  detailLevel: 'basic',
  apiRateLimitMs: 500,
});

const results = await pool.searchMany(['nike', 'adidas', 'puma', 'reebok', 'converse']);

for (const r of results) {
  if (r.results) {
    console.log(`${r.query}: ${r.results.metadata.totalResults} results (worker ${r.workerId})`);
  } else {
    console.log(`${r.query}: ${r.error?.message}`);
  }
}

await pool.close();
```

## Programmatic Usage

### Basic Search

```typescript
import { searchTrademarks } from '@optilo/impi-scraper';

const results = await searchTrademarks('vitrum', {
  detailLevel: 'basic',  // 'basic' or 'full'
  headless: true,        // Set to false to see the browser
  humanBehavior: true    // Enable human-like interactions
});

console.log(`Found ${results.results.length} trademarks`);
```

### Full Details Search

```typescript
import { IMPIApiClient } from '@optilo/impi-scraper';

const client = new IMPIApiClient({
  detailLevel: 'full',   // Fetches owner info, classes, history
  headless: true,
  apiRateLimitMs: 500,   // Rate limit between API calls
  maxRetries: 3
});

const results = await client.search('nike');

// Access full details
results.results.forEach(tm => {
  console.log(`${tm.title} - Owner: ${tm.ownerName}`);
  console.log(`Classes: ${tm.classes?.map(c => c.classNumber).join(', ')}`);
});

await client.close();
```

### Low-Level API Access

For more control, use the API client directly:

```typescript
import { IMPIApiClient } from '@optilo/impi-scraper';

const client = new IMPIApiClient({ headless: true });

// Initialize session (browser for token, then closes)
await client.initSession();

// Quick search to get searchId
const { searchId, totalResults } = await client.quickSearch('vitrum');

// Fetch results via direct API (fast, no browser)
const page1 = await client.getSearchResults(searchId, 0, 100);
const page2 = await client.getSearchResults(searchId, 1, 100);

// Fetch details via direct API
const details = await client.getTrademarkDetails('RM2020001234', searchId);

await client.close();
```

### Search with Proxy

```typescript
import { searchTrademarks } from '@optilo/impi-scraper';

// Option 1: Explicit proxy configuration
const results = await searchTrademarks('vitrum', {
  proxy: {
    server: 'http://proxy.example.com:8080',
    username: 'user',  // Optional
    password: 'pass'   // Optional
  }
});

// The external IP used is returned in metadata
console.log(`Search used IP: ${results.metadata.externalIp}`);

// Option 2: Use environment variable (automatically detected)
// Set IMPI_PROXY_URL=http://user:pass@proxy:8080 before running
const results2 = await searchTrademarks('vitrum');
// Proxy will be automatically used from env var
```

## Proxy Rotation with IPFoxy

For high-volume scraping, use the built-in [IPFoxy](https://www.ipfoxy.com/) integration to get fresh rotating IPs. Each request to the IPFoxy API returns proxy credentials with a unique session ID that routes through a different IP address.

### Quick Start

1. **Get an API token** from [IPFoxy](https://www.ipfoxy.com/)

2. **Create `.env` file** (copy from `.env.example`):
   ```bash
   IPFOXY_API_TOKEN=your_api_token_here
   ```

3. **Test it works:**
   ```bash
   tsx cli.ts fetch-proxies 1
   ```

### How It Works

IPFoxy uses session-based IP rotation. Each proxy returned has a unique session ID suffix (`_10000`, `_10001`, etc.) that routes through a different IP:

```bash
$ tsx cli.ts fetch-proxies 3

Fetched 3 proxy(ies):
Proxy 1: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10000  -> IP: 1.2.3.4
Proxy 2: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10001  -> IP: 5.6.7.8
Proxy 3: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10002  -> IP: 9.10.11.12
```

### Programmatic Usage

#### Basic: Single Proxy

```typescript
import { fetchProxiesFromEnv, searchTrademarks } from '@optilo/impi-scraper';

// Fetch one proxy and use it
const proxyResult = await fetchProxiesFromEnv(1);

if (proxyResult) {
  const proxy = proxyResult.proxies[0];
  const results = await searchTrademarks('vitrum', { proxy });
  console.log(`Used IP: ${results.metadata.externalIp}`);
}
```

#### Advanced: Concurrent Searches with Different IPs

```typescript
import { fetchProxiesFromEnv, searchTrademarks } from '@optilo/impi-scraper';

// Fetch 5 proxies (5 different IPs)
const proxyResult = await fetchProxiesFromEnv(5);

if (proxyResult) {
  const keywords = ['nike', 'adidas', 'puma', 'reebok', 'converse'];

  // Run all searches concurrently, each with a different IP
  const searches = keywords.map((keyword, i) =>
    searchTrademarks(keyword, { proxy: proxyResult.proxies[i] })
  );

  const allResults = await Promise.all(searches);

  // Each search used a different IP
  allResults.forEach((result, i) => {
    console.log(`${keywords[i]}: ${result.results.length} results (IP: ${result.metadata.externalIp})`);
  });
}
```

#### Direct API Access

```typescript
import {
  fetchIPFoxyProxies,
  parseProxyProviderFromEnv,
  type ProxyProviderConfig
} from '@optilo/impi-scraper';

// Option 1: Use env config
const config = parseProxyProviderFromEnv();
if (config) {
  const result = await fetchIPFoxyProxies(config, 3);
  console.log(result.proxies);
}

// Option 2: Manual config
const manualConfig: ProxyProviderConfig = {
  provider: 'ipfoxy',
  apiToken: 'your-token-here',
  host: 'gate-sg.ipfoxy.io',  // Optional, this is default
  port: 58688,                 // Optional, this is default
};
const result = await fetchIPFoxyProxies(manualConfig, 3);
```

### Testing Proxy Connectivity

Run the integration tests to verify proxy functionality:

```bash
# Test IPFoxy API + proxy connectivity
pnpm test tests/proxy.integration.test.ts
```

This tests:
- Fetching proxies from IPFoxy API
- Unique session IDs for each proxy
- Actual proxy connectivity (browser connects through proxy)

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | boolean | `true` | Run browser in headless mode |
| `apiRateLimitMs` | number | `500` | Milliseconds between API requests |
| `maxRetries` | number | `3` | Max retries on failure |
| `humanBehavior` | boolean | `true` | Enable human-like interactions |
| `detailLevel` | 'basic' \| 'full' | `'basic'` | Level of detail to fetch |
| `maxResults` | number | `0` | Limit results (0 = no limit) |
| `proxy` | ProxyConfig | `undefined` | Proxy configuration (see below) |

### Proxy Configuration

```typescript
interface ProxyConfig {
  server: string;      // e.g., "http://proxy.example.com:8080"
  username?: string;   // Optional proxy authentication
  password?: string;
}
```

**Priority order:**
1. Explicit `proxy` option in code
2. `IMPI_PROXY_URL` environment variable
3. `PROXY_URL` environment variable
4. `HTTP_PROXY` / `HTTPS_PROXY` environment variables

## Response Structure

```typescript
interface SearchResults {
  metadata: {
    query: string;
    executedAt: string;          // ISO datetime
    searchId: string | null;     // UUID for the search
    searchUrl: string | null;    // Direct link to IMPI results
    totalResults?: number;
    externalIp?: string | null;  // IP address used for the request
  };
  results: TrademarkResult[];
  performance: {
    durationMs: number;
    avgPerResultMs: number;
  };
}

interface TrademarkResult {
  // Core identifiers
  impiId: string;                // e.g., "RM200200532011"
  detailsUrl: string;            // Direct link to IMPI details page
  title: string;
  status: string;                // "REGISTRADO", "EN TRAMITE", etc.
  applicationNumber: string;
  registrationNumber: string | null;
  appType: string;

  // Dates (ISO format: YYYY-MM-DD)
  applicationDate: string | null;
  registrationDate: string | null;
  publicationDate: string | null;
  expiryDate: string | null;
  cancellationDate: string | null;

  // Content
  goodsAndServices: string;
  viennaCodes: string | null;    // Vienna classification codes (full details only)

  // Media
  imageUrl: string | string[];   // IMPI image URL

  // Owner info
  ownerName?: string | null;     // First owner's name
  owners?: TrademarkOwner[];     // Full owner details (full details mode)

  // Classifications
  classes?: TrademarkClass[];    // Nice classes with goods/services

  // Priority claims
  priorities?: TrademarkPriority[];  // International priority claims

  // History (full details only)
  history?: TrademarkHistory[];
}

interface TrademarkOwner {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

interface TrademarkClass {
  classNumber: number;           // Nice class 1-45
  goodsAndServices: string;      // Description (full details only)
}

interface TrademarkPriority {
  country: string;
  applicationNumber: string;
  applicationDate: string | null;
}

interface TrademarkHistory {
  procedureEntreeSheet: string;
  description: string;
  receptionYear: number | null;
  startDate: string | null;
  dateOfConclusion: string | null;
  pdfUrl: string;                // Link to archive document
  email: string | null;
  oficios: TrademarkOficio[];    // Official correspondence
}

interface TrademarkOficio {
  description: string;           // e.g., "CONCESION DE LA PROTECCION"
  officeNumber: string;
  date: string | null;
  notificationStatus: string;
  pdfUrl: string;
}
```

## Error Handling

The scraper throws typed errors (`IMPIError`) with specific error codes for different failure scenarios:

```typescript
import { searchTrademarks, IMPIError } from '@optilo/impi-scraper';

try {
  const results = await searchTrademarks('vitrum');
} catch (err) {
  if (err instanceof IMPIError) {
    console.log('Error code:', err.code);
    console.log('Message:', err.message);
    console.log('HTTP status:', err.httpStatus);
    console.log('Retryable:', err.isRetryable);

    // Handle specific error types
    switch (err.code) {
      case 'RATE_LIMITED':
        console.log(`Wait ${err.retryAfter} seconds before retrying`);
        break;
      case 'CAPTCHA_REQUIRED':
        console.log('CAPTCHA challenge detected - try again later');
        break;
      case 'BLOCKED':
        console.log('Access blocked - may need to wait or change IP');
        break;
      case 'TIMEOUT':
        console.log('Request timed out - IMPI may be slow');
        break;
    }
  }
}
```

### Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `RATE_LIMITED` | HTTP 429 - Too many requests | Yes |
| `BLOCKED` | HTTP 403 - Access denied/blocked | No |
| `CAPTCHA_REQUIRED` | CAPTCHA challenge detected | No |
| `TIMEOUT` | Request or operation timeout | Yes |
| `NETWORK_ERROR` | Network connectivity issues | Yes |
| `PARSE_ERROR` | Failed to parse response | No |
| `SESSION_EXPIRED` | XSRF token or session invalid | No |
| `NOT_FOUND` | No results or resource not found | No |
| `SERVER_ERROR` | HTTP 5xx errors | Yes |
| `UNKNOWN` | Unclassified error | No |

### IMPIError Properties

```typescript
interface IMPIError extends Error {
  code: IMPIErrorCode;      // Error classification
  httpStatus?: number;      // HTTP status code (if applicable)
  retryAfter?: number;      // Seconds to wait (for rate limiting)
  url?: string;             // URL that caused the error
  timestamp: string;        // When the error occurred
  isRetryable: boolean;     // Whether retry might succeed
}
```

## Testing

```bash
# Run unit tests (fast, no network)
pnpm test

# Run all integration tests (requires network, slow)
pnpm test:integration

# Run specific integration tests
pnpm test:search     # Keyword search tests
pnpm test:details    # Full details tests
pnpm test:proxy      # IPFoxy API + proxy connectivity tests

# Watch mode for development
pnpm test:watch
```

## Project Structure

```
impi-scraper/
├── cli.ts                    # CLI entry point
├── src/
│   ├── index.ts              # Main exports
│   ├── api.ts                # IMPIApiClient and searchTrademarks()
│   ├── api.test.ts           # Unit tests for API client
│   ├── types.ts              # TypeScript type definitions
│   └── utils/
│       ├── human-behavior.ts # Anti-detection utilities
│       ├── human-behavior.test.ts
│       ├── data.ts           # Data parsing utilities
│       ├── data.test.ts
│       ├── logger.ts         # Logging utility
│       ├── proxy.ts          # Proxy configuration utilities
│       ├── proxy.test.ts
│       └── proxy-provider.ts # IPFoxy API integration for rotating proxies
├── tests/
│   ├── search.integration.test.ts   # Keyword search tests
│   ├── details.integration.test.ts  # Full details tests
│   └── proxy.integration.test.ts    # Proxy functionality tests
├── examples/
│   ├── search-vitrum.ts      # Basic search example
│   └── full-details.ts       # Full details example
├── package.json
└── README.md
```

## Importing into Another Project

### Option 1: Copy the source

Copy the `src/` folder into your project and import:

```typescript
import { searchTrademarks, IMPIApiClient } from './path/to/src/index';
```

### Option 2: Local package reference

In your project's `package.json`:

```json
{
  "dependencies": {
    "@optilo/impi-scraper": "file:../path/to/impi-scraper"
  }
}
```

Then install and import:

```bash
pnpm install
```

```typescript
import { searchTrademarks } from '@optilo/impi-scraper';
```

### Option 3: Git submodule

```bash
git submodule add <repo-url> packages/impi-scraper
```

## npm Scripts

| Script | Description |
|--------|-------------|
| `pnpm run search <keyword>` | Quick search shortcut |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run all integration tests |
| `pnpm test:search` | Run search integration tests |
| `pnpm test:details` | Run details integration tests |
| `pnpm test:proxy` | Run proxy/IPFoxy integration tests |
| `pnpm typecheck` | Run TypeScript type checking |

## How It Works

1. **Session Initialization**: Uses Camoufox (Firefox with anti-detection) to navigate to IMPI search page and extract session tokens (XSRF-TOKEN, JSESSIONID, SESSIONTOKEN)
2. **Browser Closes**: After getting tokens, the browser closes to save resources
3. **API Calls**: All subsequent search and detail requests use direct HTTP API calls with the session tokens
4. **Token Refresh**: Sessions are automatically refreshed when they expire (typically every 25-30 minutes)

This approach provides:
- **Speed**: Direct API calls are 10-50x faster than browser automation
- **Reliability**: No browser crashes or memory leaks during data fetching
- **Anti-Detection**: Only the initial page load uses a browser, reducing detection risk
- **Low Resource Usage**: No browser running during the actual scraping

## Serverless/Queue Architecture

For environments that cannot run Playwright/Camoufox (Vercel, Cloudflare Workers, AWS Lambda, etc.), the scraper supports a split architecture:

1. **Local/Docker**: Generate tokens + searchId (requires browser)
2. **Serverless**: Fetch data using pure HTTP (no browser needed)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LOCAL CLI (has Camoufox)                         │
│  tsx cli.ts generate-search "nike" -o search.json                   │
│                           │                                         │
│                           ▼                                         │
│  { tokens, searchId, totalResults, query, generatedAt }            │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ Pass to queue (Trigger.dev, etc.)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 SERVERLESS (pure HTTP, no browser)                  │
│                                                                     │
│  const client = new IMPIHttpClient(payload.tokens);                │
│  const results = await client.fetchAllResults(                      │
│    payload.searchId,                                                │
│    payload.totalResults                                             │
│  );                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### CLI Commands

```bash
# Generate tokens + searchId for a query (outputs JSON)
tsx cli.ts generate-search nike -o nike-search.json

# Generate session tokens only (reusable for multiple searches)
tsx cli.ts generate-tokens -o tokens.json

# With proxy
tsx cli.ts generate-search nike --proxy http://user:pass@proxy:8080
```

### Programmatic Usage

#### Step 1: Generate Search Data (Local/Docker)

```typescript
import { generateSearch } from '@optilo/impi-scraper';

// This requires Camoufox - run locally or in Docker
const search = await generateSearch('nike', {
  headless: true,
  proxy: { server: 'http://proxy:8080' }  // Optional
});

console.log(search);
// {
//   tokens: { xsrfToken, jsessionId, sessionToken, obtainedAt, expiresAt },
//   searchId: "abc-123-def",
//   totalResults: 150,
//   query: "nike",
//   generatedAt: "2024-01-15T10:30:00.000Z"
// }

// Send to your queue system
await myQueue.trigger(search);
```

#### Step 2: Process in Serverless (No Browser)

```typescript
import { IMPIHttpClient, type GeneratedSearch } from '@optilo/impi-scraper';

// In your Trigger.dev/Vercel/Lambda handler
export async function processSearch(payload: GeneratedSearch) {
  // Pure HTTP client - NO Camoufox/Playwright needed
  const client = new IMPIHttpClient(payload.tokens, {
    apiRateLimitMs: 0,    // No client-side throttling
    detailLevel: 'basic'
  });

  // Check token validity
  if (client.isTokenExpired()) {
    throw new Error('Tokens expired - regenerate locally');
  }

  // Fetch all results (paginated automatically)
  const rawResults = await client.fetchAllResults(
    payload.searchId,
    payload.totalResults,
    100  // Optional: limit to 100 results
  );

  // Or get full SearchResults format
  const results = await client.processSearch(
    payload.searchId,
    payload.totalResults,
    payload.query
  );

  return results;
}
```

### IMPIHttpClient API

```typescript
class IMPIHttpClient {
  constructor(tokens: SessionTokens, options?: IMPIHttpClientOptions);

  // Token management
  isTokenExpired(): boolean;
  getTokenLifetimeMs(): number;

  // Data fetching (pure HTTP)
  fetchSearchResults(searchId: string, pageNumber?: number, pageSize?: number): Promise<IMPISearchResponse>;
  fetchAllResults(searchId: string, totalResults: number, maxResults?: number): Promise<IMPITrademarkRaw[]>;
  fetchTrademarkDetails(impiId: string, searchId?: string): Promise<IMPIDetailsResponse>;
  fetchAllResultsWithDetails(searchId: string, totalResults: number, maxResults?: number): Promise<TrademarkResult[]>;
  processSearch(searchId: string, totalResults: number, query: string, maxResults?: number): Promise<SearchResults>;
}
```

### Token Lifecycle

- Tokens are valid for ~25-30 minutes (JWT-based)
- `generateSearch()` returns `expiresAt` timestamp
- Use `client.isTokenExpired()` to check before processing
- For long-running queues, regenerate tokens periodically

### Example: Trigger.dev Integration

```typescript
// trigger/impi-search.ts
import { task } from '@trigger.dev/sdk/v3';
import { IMPIHttpClient, type GeneratedSearch } from '@optilo/impi-scraper';

export const processIMPISearch = task({
  id: 'process-impi-search',
  run: async (payload: GeneratedSearch) => {
    const client = new IMPIHttpClient(payload.tokens);

    if (client.isTokenExpired()) {
      throw new Error(`Tokens expired for query: ${payload.query}`);
    }

    const results = await client.processSearch(
      payload.searchId,
      payload.totalResults,
      payload.query
    );

    return {
      query: payload.query,
      totalResults: results.metadata.totalResults,
      processed: results.results.length,
      results: results.results
    };
  }
});

// Local script to trigger
import { generateSearch } from '@optilo/impi-scraper';
import { processIMPISearch } from './trigger/impi-search';

const search = await generateSearch('nike');
await processIMPISearch.trigger(search);
```

## Notes

- Client-side rate limiting has been removed; rely on server responses for throttling
- Human behavior simulation adds slight delays but helps avoid detection
- Full detail mode makes additional API calls per result (slower but more data)
- Results are returned in ISO date format (YYYY-MM-DD)
- Proxy configuration supports HTTP, HTTPS, and SOCKS5 protocols
- When using rotating proxies, each browser session gets a fresh IP

## License

MIT
