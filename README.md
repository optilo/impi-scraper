# IMPI Trademark Scraper

A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial) - the Mexican trademark office. Uses Crawlee + Playwright with human-like interactions and anti-detection features.

## Features

- **Keyword Search**: Search trademarks by keyword
- **Human-like Behavior**: Simulates real user interactions (mouse movements, typing delays, scrolling)
- **Anti-Detection**: Built-in measures to avoid bot detection
- **Proxy Support**: Route requests through HTTP/SOCKS proxies for IP rotation
- **IPFoxy Integration**: Built-in support for [IPFoxy](https://www.ipfoxy.com/) rotating proxy API
- **External IP Detection**: Returns the IP address used for each request
- **Full Details**: Option to fetch complete trademark information including owners, classes, and history
- **CLI Interface**: Easy command-line access with multiple output formats
- **TypeScript**: Fully typed with comprehensive type definitions

## Installation

```bash
# Install dependencies
bun install

# Install Playwright browser (first time only)
bunx playwright install chromium
```

## CLI Usage

The easiest way to use the scraper:

```bash
# Basic keyword search
bun cli.ts search vitrum

# Search with full details (owners, classes, history)
bun cli.ts search vitrum --full

# Output to file
bun cli.ts search "coca cola" -o results.json

# Table format output
bun cli.ts search nike --format table

# Summary format
bun cli.ts search nike --format summary

# Show browser window (useful for debugging)
bun cli.ts search vitrum --visible

# Enable human-like behavior (slower but less detectable)
bun cli.ts search vitrum --human

# Limit results
bun cli.ts search nike --limit 5

# Search with proxy
bun cli.ts search vitrum --proxy http://user:pass@proxy.example.com:8080

# Using environment variable for proxy
IMPI_PROXY_URL=http://proxy:8080 bun cli.ts search vitrum
```

### CLI Commands

```bash
# Search trademarks
bun cli.ts search <keyword> [options]

# Fetch fresh proxies from IPFoxy
bun cli.ts fetch-proxies [count]
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
bun cli.ts search vitrum
```

**Table**: Quick overview in terminal
```bash
bun cli.ts search vitrum --format table
```

**Summary**: Human-readable summary
```bash
bun cli.ts search vitrum --format summary
```

## Programmatic Usage

### Basic Search

```typescript
import { searchTrademarks } from './src/index';

const results = await searchTrademarks('vitrum', {
  detailLevel: 'basic',  // 'basic' or 'full'
  headless: true,        // Set to false to see the browser
  humanBehavior: true    // Enable human-like interactions
});

console.log(`Found ${results.results.length} trademarks`);
```

### Full Details Search

```typescript
import { IMPIScraper } from './src/index';

const scraper = new IMPIScraper({
  detailLevel: 'full',   // Fetches owner info, classes, history
  headless: true,
  rateLimitMs: 2500,     // 2.5 seconds between detail requests
  maxRetries: 3
});

const results = await scraper.search('nike');

// Access full details
results.results.forEach(tm => {
  console.log(`${tm.title} - Owner: ${tm.ownerName}`);
  console.log(`Classes: ${tm.classes?.map(c => c.classNumber).join(', ')}`);
});
```

### Search with Proxy

```typescript
import { searchTrademarks } from './src/index';

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
   bun cli.ts fetch-proxies 1
   ```

### How It Works

IPFoxy uses session-based IP rotation. Each proxy returned has a unique session ID suffix (`_10000`, `_10001`, etc.) that routes through a different IP:

```bash
$ bun cli.ts fetch-proxies 3

✅ Fetched 3 proxy(ies):
Proxy 1: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10000  → IP: 1.2.3.4
Proxy 2: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10001  → IP: 5.6.7.8
Proxy 3: Server: http://gate-sg.ipfoxy.io:58688
  Username: customer-xxx-sessid-123_10002  → IP: 9.10.11.12
```

### Programmatic Usage

#### Basic: Single Proxy

```typescript
import { fetchProxiesFromEnv, searchTrademarks } from './src/index';

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
import { fetchProxiesFromEnv, searchTrademarks } from './src/index';

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
} from './src/index';

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
bun test tests/proxy.integration.test.ts
```

This tests:
- Fetching proxies from IPFoxy API
- Unique session IDs for each proxy
- Actual proxy connectivity (browser connects through proxy)

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | boolean | `true` | Run browser in headless mode |
| `rateLimitMs` | number | `2000` | Milliseconds between requests |
| `maxConcurrency` | number | `1` | Max concurrent requests |
| `maxRetries` | number | `3` | Max retries on failure |
| `humanBehavior` | boolean | `false` | Enable human-like interactions |
| `detailLevel` | 'basic' \| 'full' | `'basic'` | Level of detail to fetch |
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
  status: string;                // "REGISTRADO", "EN TRÁMITE", etc.
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
  description: string;           // e.g., "CONCESIÓN DE LA PROTECCIÓN"
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
bun test src/

# Run all integration tests (requires network, slow)
bun test:integration

# Run specific integration tests
bun test:search     # Keyword search tests
bun test:details    # Full details tests
bun test:proxy      # IPFoxy API + proxy connectivity tests

# Watch mode for development
bun test:watch
```

## Project Structure

```
impi-scraper/
├── cli.ts                    # CLI entry point
├── src/
│   ├── index.ts              # Main exports
│   ├── api.ts                # Simple searchTrademarks() API
│   ├── scraper.ts            # Core IMPIScraper class
│   ├── types.ts              # TypeScript type definitions
│   ├── scraper.test.ts       # Unit tests
│   └── utils/
│       ├── human-behavior.ts # Anti-detection utilities
│       ├── human-behavior.test.ts
│       ├── data.ts           # Data parsing utilities
│       ├── data.test.ts
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
import { searchTrademarks, IMPIScraper } from './path/to/src/index';
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
bun install
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
| `bun run search <keyword>` | Quick search shortcut |
| `bun test` | Run unit tests |
| `bun test:integration` | Run all integration tests |
| `bun test:search` | Run search integration tests |
| `bun test:details` | Run details integration tests |
| `bun test:proxy` | Run proxy/IPFoxy integration tests |

## Notes

- The scraper respects rate limits to avoid overloading the IMPI server
- Human behavior simulation adds slight delays but helps avoid detection
- Full detail mode makes additional API calls per result (slower but more data)
- Results are returned in ISO date format (YYYY-MM-DD)
- External IP is detected at the start of each search session using ipify.org
- Proxy configuration supports HTTP, HTTPS, and SOCKS5 protocols
- When using rotating proxies, each browser session gets a fresh IP

## License

MIT
