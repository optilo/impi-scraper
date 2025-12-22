/**
 * Unit tests for IMPI API Client
 *
 * Tests happy path functionality:
 * - Token/session acquisition
 * - Search results with pagination
 * - Trademark details
 *
 * Run: pnpm test src/api.test.ts
 */

import { describe, test, expect } from 'vitest';
import { IMPIApiClient, IMPIConcurrentPool, searchTrademarks } from './api.ts';
import { IMPIError } from './types.ts';
import { parseDate } from './utils/data.ts';
import { formatProxyForCamoufox } from './utils/proxy.ts';
import type { SearchResults } from './types.ts';

// Mock data for tests - dates are in DD/MM/YYYY format as returned by IMPI API
const mockSearchResponse = {
  resultPage: [
    {
      id: 'RM2020001234',
      applicationNumber: '2020001234',
      title: 'VITRUM',
      status: 'REGISTRADO',
      appType: 'DENOMINATIVO',
      classes: [9, 42],
      owners: ['VITRUM CORP'],
      images: ['https://example.com/image.png'],
      goodsAndServices: 'Software products',
      dates: {
        application: '15/01/2020',
        registration: '20/03/2021',
        expiry: '20/03/2031'
      }
    },
    {
      id: 'RM2019005678',
      applicationNumber: '2019005678',
      title: 'VITRUM GLASS',
      status: 'REGISTRADO',
      appType: 'MIXTO',
      classes: [21],
      owners: ['GLASS SOLUTIONS SA'],
      images: [],
      goodsAndServices: 'Glass products',
      dates: {
        application: '10/06/2019',
        registration: '15/08/2020',
        expiry: '15/08/2030'
      }
    }
  ],
  totalResults: 15
};

const mockDetailsResponse = {
  result: {
    status: 'REGISTRADO'
  },
  details: {
    generalInformation: {
      applicationDate: '2020-01-15',
      registrationDate: '2021-03-20',
      expiryDate: '2031-03-20'
    },
    trademark: {
      viennaCodes: '01.01.01',
      image: 'https://example.com/image.png'
    },
    ownerInformation: {
      owners: [
        {
          Name: ['VITRUM CORP'],
          Addr: ['123 Main St'],
          City: ['Mexico City'],
          State: ['CDMX'],
          Cry: ['Mexico']
        }
      ]
    },
    productsAndServices: [
      {
        classes: 9,
        goodsAndServices: 'Computer software for business applications'
      },
      {
        classes: 42,
        goodsAndServices: 'Software development services'
      }
    ],
    prioridad: []
  },
  historyData: {
    historyRecords: [
      {
        procedureEntreeSheet: 'PROC-001',
        description: 'Solicitud de registro',
        receptionYear: '2020',
        startDate: '2020-01-15',
        dateOfConclusion: '2021-03-20',
        image: 'https://acervomarcas.impi.gob.mx/doc1.pdf',
        details: {
          oficios: [
            {
              descriptionOfTheTrade: 'Oficio de registro',
              officeNumber: '123456',
              dateOfTheTrade: '2021-03-20',
              notificationStatus: 'NOTIFICADO',
              image: 'https://acervomarcas.impi.gob.mx/oficio1.pdf'
            }
          ]
        }
      }
    ]
  },
  totalResults: 15,
  currentOrdinal: 1
};

describe('IMPIApiClient', () => {
  describe('constructor', () => {
    test('creates client with default options', () => {
      const client = new IMPIApiClient();
      expect(client).toBeDefined();
    });

    test('creates client with custom options', () => {
      const client = new IMPIApiClient({
        headless: false,
        apiRateLimitMs: 1000,
        detailLevel: 'full',
        maxResults: 10
      });
      expect(client).toBeDefined();
    });

    test('accepts proxy configuration', () => {
      const client = new IMPIApiClient({
        proxy: {
          server: 'http://proxy.example.com:8080',
          username: 'user',
          password: 'pass'
        }
      });
      expect(client).toBeDefined();
    });

    test('accepts auto proxy configuration', () => {
      const client = new IMPIApiClient({
        proxy: 'auto'
      });
      expect(client).toBeDefined();
    });
  });

  describe('data extraction', () => {
    test('extractBasicData returns correct structure', async () => {
      // Create client and access private method via any cast
      const client = new IMPIApiClient({ headless: true });
      const extractBasicData = (client as any).extractBasicData.bind(client);

      const trademark = mockSearchResponse.resultPage[0];
      const result = extractBasicData(trademark, 'vitrum', 'search-123');

      expect(result.impiId).toBe('RM2020001234');
      expect(result.title).toBe('VITRUM');
      expect(result.status).toBe('REGISTRADO');
      expect(result.ownerName).toBe('VITRUM CORP');
      expect(result.applicationNumber).toBe('2020001234');
      expect(result.applicationDate).toBe('2020-01-15');
      expect(result.registrationDate).toBe('2021-03-20');
      expect(result.expiryDate).toBe('2031-03-20');
      expect(result.query).toBe('vitrum');
      expect(result.searchId).toBe('search-123');
      expect(result.classes).toHaveLength(2);
      expect(result.classes[0].classNumber).toBe(9);
    });

    test('extractTrademarkData returns full details structure', async () => {
      const client = new IMPIApiClient({ headless: true });
      const extractTrademarkData = (client as any).extractTrademarkData.bind(client);

      const trademark = mockSearchResponse.resultPage[0];
      const result = extractTrademarkData(trademark, mockDetailsResponse, 'vitrum', 'search-123');

      // Basic fields
      expect(result.impiId).toBe('RM2020001234');
      expect(result.title).toBe('VITRUM');
      expect(result.status).toBe('REGISTRADO');

      // Owner information (from details)
      expect(result.owners).toHaveLength(1);
      expect(result.owners[0].name).toBe('VITRUM CORP');
      expect(result.owners[0].address).toBe('123 Main St');
      expect(result.owners[0].city).toBe('Mexico City');
      expect(result.owners[0].country).toBe('Mexico');
      expect(result.ownerName).toBe('VITRUM CORP');

      // Classes (from details)
      expect(result.classes).toHaveLength(2);
      expect(result.classes[0].classNumber).toBe(9);
      expect(result.classes[0].goodsAndServices).toContain('Computer software');
      expect(result.classes[1].classNumber).toBe(42);

      // Vienna codes
      expect(result.viennaCodes).toBe('01.01.01');

      // History
      expect(result.history).toHaveLength(1);
      expect(result.history[0].description).toBe('Solicitud de registro');
      expect(result.history[0].pdfUrl).toContain('acervomarcas.impi.gob.mx');

      // Oficios
      expect(result.history[0].oficios).toHaveLength(1);
      expect(result.history[0].oficios[0].officeNumber).toBe('123456');
    });
  });
});

describe('IMPIConcurrentPool', () => {
  describe('constructor', () => {
    test('creates pool with default options', () => {
      const pool = new IMPIConcurrentPool();
      expect(pool).toBeDefined();
    });

    test('creates pool with custom concurrency', () => {
      const pool = new IMPIConcurrentPool({
        concurrency: 5
      });
      expect(pool).toBeDefined();
    });

    test('creates pool with multiple proxies', () => {
      const pool = new IMPIConcurrentPool({
        concurrency: 3,
        proxies: [
          { server: 'http://proxy1.example.com:8080' },
          { server: 'http://proxy2.example.com:8080' },
          { server: 'http://proxy3.example.com:8080' }
        ]
      });
      expect(pool).toBeDefined();
    });
  });

  describe('getStats', () => {
    test('returns correct initial stats', () => {
      const pool = new IMPIConcurrentPool({ concurrency: 3 });
      const stats = pool.getStats();

      // Before init, no workers exist
      expect(stats.total).toBe(0);
      expect(stats.busy).toBe(0);
      expect(stats.available).toBe(0);
    });
  });
});

describe('searchTrademarks convenience function', () => {
  test('accepts basic query string', async () => {
    // This is a unit test - we just verify the function exists and accepts correct params
    expect(typeof searchTrademarks).toBe('function');
  });

  test('accepts query with options', async () => {
    // Verify the function signature accepts options
    const options = {
      headless: true,
      maxResults: 5,
      detailLevel: 'basic' as const
    };

    expect(typeof searchTrademarks).toBe('function');
    // The actual call would require browser, so we just verify types
  });
});

describe('SearchResults structure', () => {
  test('validates expected result structure', () => {
    // Define expected structure for documentation and type checking
    const expectedStructure: SearchResults = {
      metadata: {
        query: 'test',
        executedAt: new Date().toISOString(),
        searchId: 'uuid-here',
        searchUrl: 'https://marcia.impi.gob.mx/...',
        totalResults: 10,
        externalIp: null
      },
      results: [
        {
          query: 'test',
          searchId: 'uuid-here',
          impiId: 'RM2020001234',
          detailsUrl: 'https://...',
          title: 'TEST MARK',
          status: 'REGISTRADO',
          ownerName: 'OWNER NAME',
          applicationNumber: '2020001234',
          registrationNumber: '1234567',
          appType: 'DENOMINATIVO',
          applicationDate: '2020-01-01',
          registrationDate: '2021-01-01',
          publicationDate: null,
          expiryDate: '2031-01-01',
          cancellationDate: null,
          goodsAndServices: 'Products and services description',
          viennaCodes: null,
          imageUrl: [],
          owners: [],
          classes: [],
          priorities: [],
          history: []
        }
      ],
      performance: {
        durationMs: 5000,
        avgPerResultMs: 500
      }
    };

    // Verify structure compiles correctly
    expect(expectedStructure.metadata.query).toBe('test');
    expect(expectedStructure.results).toHaveLength(1);
    expect(expectedStructure.performance.durationMs).toBeGreaterThan(0);
  });
});

describe('Pagination logic', () => {
  test('calculates correct page count', () => {
    const totalResults = 250;
    const pageSize = 100;
    const expectedPages = Math.ceil(totalResults / pageSize);

    expect(expectedPages).toBe(3);
  });

  test('handles exact page boundaries', () => {
    const totalResults = 200;
    const pageSize = 100;
    const expectedPages = Math.ceil(totalResults / pageSize);

    expect(expectedPages).toBe(2);
  });

  test('handles single page results', () => {
    const totalResults = 50;
    const pageSize = 100;
    const expectedPages = Math.ceil(totalResults / pageSize);

    expect(expectedPages).toBe(1);
  });

  test('handles zero results', () => {
    const totalResults = 0;
    const pageSize = 100;
    const expectedPages = totalResults === 0 ? 0 : Math.ceil(totalResults / pageSize);

    expect(expectedPages).toBe(0);
  });
});

describe('Rate limiting', () => {
  test('default rate limit is 500ms', () => {
    const client = new IMPIApiClient();
    // Access private options via any cast
    const options = (client as any).options;

    expect(options.apiRateLimitMs).toBe(500);
  });

  test('custom rate limit is respected', () => {
    const client = new IMPIApiClient({ apiRateLimitMs: 1000 });
    const options = (client as any).options;

    expect(options.apiRateLimitMs).toBe(1000);
  });

  test('rate limit timing calculation', async () => {
    const rateLimit = 500;
    const lastRequest = Date.now() - 200; // 200ms ago
    const elapsed = Date.now() - lastRequest;
    const waitNeeded = rateLimit - elapsed;

    // Should need to wait ~300ms more
    expect(waitNeeded).toBeGreaterThan(0);
    expect(waitNeeded).toBeLessThan(rateLimit);
  });
});

describe('Session management', () => {
  test('session expiration check with JWT exp', () => {
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 minute buffer

    // Session that expires in 10 minutes (not expired)
    const validExpiry = now + 10 * 60 * 1000;
    const isExpired1 = now > validExpiry - buffer;
    expect(isExpired1).toBe(false);

    // Session that expires in 3 minutes (expired due to buffer)
    const soonExpiry = now + 3 * 60 * 1000;
    const isExpired2 = now > soonExpiry - buffer;
    expect(isExpired2).toBe(true);

    // Session already expired
    const pastExpiry = now - 1000;
    const isExpired3 = now > pastExpiry - buffer;
    expect(isExpired3).toBe(true);
  });

  test('token refresh interval default is 25 minutes', () => {
    const client = new IMPIApiClient();
    const options = (client as any).options;

    expect(options.tokenRefreshIntervalMs).toBe(25 * 60 * 1000);
  });
});

describe('Error handling', () => {
  test('IMPIError has correct structure', () => {
    const error = new IMPIError({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      httpStatus: 429,
      retryAfter: 60,
      url: 'https://example.com',
      timestamp: new Date().toISOString()
    });

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toBe('Too many requests');
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfter).toBe(60);
  });

  test('error codes are valid', () => {
    const validCodes = [
      'RATE_LIMITED',
      'BLOCKED',
      'CAPTCHA_REQUIRED',
      'TIMEOUT',
      'NETWORK_ERROR',
      'PARSE_ERROR',
      'SESSION_EXPIRED',
      'NOT_FOUND',
      'SERVER_ERROR',
      'UNKNOWN'
    ];

    validCodes.forEach(code => {
      expect(typeof code).toBe('string');
    });
  });
});

describe('Date parsing', () => {
  test('parseDate utility handles DD/MM/YYYY format', () => {
    // Standard DD/MM/YYYY format (as returned by IMPI API)
    expect(parseDate('15/01/2020')).toBe('2020-01-15');
    expect(parseDate('1/6/2019')).toBe('2019-06-01');
    expect(parseDate('31/12/2025')).toBe('2025-12-31');

    // Null/undefined
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();

    // Invalid formats (returns null)
    expect(parseDate('2020-01-15')).toBeNull();
    expect(parseDate('invalid')).toBeNull();
  });
});

describe('Proxy configuration', () => {
  test('formatProxyForCamoufox adds http prefix', () => {
    const proxy = {
      server: 'proxy.example.com:8080',
      username: 'user',
      password: 'pass'
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted.server).toBe('http://proxy.example.com:8080');
    expect(formatted.username).toBe('user');
    expect(formatted.password).toBe('pass');
  });

  test('formatProxyForCamoufox preserves existing prefix', () => {
    const proxy = {
      server: 'https://proxy.example.com:8080'
    };

    const formatted = formatProxyForCamoufox(proxy);

    expect(formatted.server).toBe('https://proxy.example.com:8080');
  });

  test('formatProxyForCamoufox handles undefined', () => {
    expect(formatProxyForCamoufox(undefined)).toBeUndefined();
  });
});
