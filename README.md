# IMPI Trademark Scraper

A TypeScript scraper for IMPI (Instituto Mexicano de la Propiedad Industrial) - the Mexican trademark office. Uses Crawlee + Playwright with human-like interactions and anti-detection features.

## Features

- **Keyword Search**: Search trademarks by keyword
- **Human-like Behavior**: Simulates real user interactions (mouse movements, typing delays, scrolling)
- **Anti-Detection**: Built-in measures to avoid bot detection
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

# Faster search (disables human-like delays)
bun cli.ts search vitrum --no-human

# Limit results
bun cli.ts search nike --limit 5
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--full` | `-f` | Fetch full details (owners, classes, history) |
| `--output FILE` | `-o` | Output to JSON file |
| `--visible` | `-v` | Show browser window |
| `--no-human` | | Disable human-like behavior (faster) |
| `--limit NUM` | `-l` | Limit number of results |
| `--format` | | Output format: json, table, summary |
| `--help` | `-h` | Show help |

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

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | boolean | `true` | Run browser in headless mode |
| `rateLimitMs` | number | `2000` | Milliseconds between requests |
| `maxConcurrency` | number | `1` | Max concurrent requests |
| `maxRetries` | number | `3` | Max retries on failure |
| `humanBehavior` | boolean | `true` | Enable human-like interactions |
| `detailLevel` | 'basic' \| 'full' | `'basic'` | Level of detail to fetch |

## Response Structure

```typescript
interface SearchResults {
  metadata: {
    query: string;
    executedAt: string;          // ISO datetime
    searchId: string | null;     // UUID for the search
    searchUrl: string | null;    // Direct link to IMPI results
    totalResults?: number;
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
# Run unit tests (fast)
bun test src/

# Run all integration tests (requires network, slow)
bun test:integration

# Run only search integration tests
bun test:search

# Run only details integration tests
bun test:details

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
│       └── data.test.ts
├── tests/
│   ├── search.integration.test.ts   # Keyword search tests
│   └── details.integration.test.ts  # Full details tests
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

## Notes

- The scraper respects rate limits to avoid overloading the IMPI server
- Human behavior simulation adds slight delays but helps avoid detection
- Full detail mode makes additional API calls per result (slower but more data)
- Results are returned in ISO date format (YYYY-MM-DD)

## License

MIT
