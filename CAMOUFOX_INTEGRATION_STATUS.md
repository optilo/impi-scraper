# Camoufox Integration Status

**Last Updated**: 2025-01-XX  
**Status**: In Progress - Diagnosing Proxy Connection Issues

## Objective

Integrate `camoufox-js` with dynamic IPFoxy proxies to bypass IP blocking on the IMPI (Mexican Trademark Office) website and stabilize session token extraction.

## Current Infrastructure

### ✅ Completed Components

1. **Dynamic Proxy Fetcher** (`src/utils/proxy-provider.ts`)
   - Fetches fresh MX proxies from IPFoxy via API
   - Supports country filtering (MX)
   - Returns `ProxyConfig` objects compatible with Playwright/Camoufox

2. **Camoufox Integration** ✅ **COMPLETED**
   - Integrated Camoufox into `src/scraper.ts` and `src/api.ts`
   - Replaces Playwright for direct searches and session initialization
   - Proxy formatting utility added (`formatProxyForCamoufox`)
   - All browser launches now use Camoufox with `geoip: true`

3. **Main Scraper** (`src/scraper.ts`)
   - Full-featured IMPI scraper using Playwright
   - Supports proxy configuration
   - Session token extraction working without proxy

4. **API Client** (`src/api.ts`)
   - Hybrid approach: browser for session tokens, direct API calls for data
   - Supports concurrent pool with multiple proxies
   - Currently blocked by proxy connection issues

## Current Issue

### Problem: `NS_ERROR_CONNECTION_REFUSED` with Proxy

**Symptoms:**
- ✅ General connectivity (Google, Ipify) works through proxy
- ✅ IP detection confirms proxy is working
- ❌ `marcia.impi.gob.mx` frequently returns `NS_ERROR_CONNECTION_REFUSED` when using proxy
- ✅ Access without proxy works fine

**Error Details:**
- Error occurs during `page.goto()` to IMPI
- Happens with Camoufox (Firefox-based)
- Similar issues documented with Playwright (see `PROXY_DEBUG_NOTES.md`)

### Root Cause Hypotheses

1. **IP Blocking**: IMPI may maintain a blacklist of known proxy IP ranges
2. **TLS/SSL Handshake**: IMPI may require specific TLS configuration that fails through proxy
3. **DNS Resolution**: `.gob.mx` domains may have DNS resolution issues through proxy
4. **Proxy Authentication**: IPFoxy proxy auth flow may not work correctly with Camoufox
5. **GeoIP Mismatch**: Even with `geoip: true`, IMPI may detect proxy characteristics

## Integration Details

Camoufox has been integrated into the main library code:

1. **Proxy Format Conversion**
   - `formatProxyForCamoufox()` utility in `src/utils/proxy.ts`
   - Ensures HTTP proxy format is correct for Camoufox
   - Handles missing protocol prefixes

2. **Browser Creation**
   - `createCamoufoxBrowser()` method in `IMPIScraper` class
   - Used in `searchDirect()`, `createFreshBrowser()`, and `searchBatch()`
   - Always enables `geoip: true` for better fingerprinting

3. **API Client Integration**
   - `IMPIApiClient.initSession()` now uses Camoufox
   - `IMPIApiClient.quickSearch()` uses Camoufox for browser interactions
   - Maintains compatibility with existing API client interface

## Usage

Camoufox is now the default browser for all direct searches and session initialization:

```typescript
import { IMPIScraper } from './src/scraper';
import { IMPIApiClient } from './src/api';

// Direct search uses Camoufox
const scraper = new IMPIScraper({ proxy: myProxy });
const results = await scraper.search('nike');

// API client uses Camoufox for session initialization
const client = new IMPIApiClient({ proxy: myProxy });
await client.initSession(); // Uses Camoufox
const results = await client.search('nike');
```

## Next Steps for Testing

### Immediate Actions

1. **Test with Real Proxy**
   - Run searches with IPFoxy proxy configured
   - Monitor for `NS_ERROR_CONNECTION_REFUSED` errors
   - Check if Camoufox resolves the connection issues

2. **Analyze Error Patterns**
   - Is it always `NS_ERROR_CONNECTION_REFUSED`?
   - Does it happen immediately or after timeout?
   - Are there any successful connections mixed with failures?

3. **Test Different Proxy Configurations**
   - Try different IPFoxy gateways (if available)
   - Test without country filter (non-MX IPs)
   - Verify proxy format conversion works correctly

### Investigation Areas

1. **Proxy Format**
   - Verify Camoufox proxy format requirements
   - Check if HTTP vs SOCKS5 makes a difference
   - Test proxy authentication flow

2. **Network Layer**
   - Use `curl` to test proxy directly (already works per `PROXY_DEBUG_NOTES.md`)
   - Compare curl vs Camoufox proxy behavior
   - Check if issue is browser-specific

3. **IMPI-Specific**
   - Test other `.gob.mx` domains through proxy
   - Check if IMPI has specific TLS requirements
   - Investigate if IMPI uses IP reputation services

4. **Alternative Approaches**
   - Local proxy tunnel (squid, mitmproxy) forwarding to IPFoxy
   - Use Camoufox without proxy for session, then switch to proxied API calls
   - Try different proxy providers (BrightData, Oxylabs, SmartProxy)

## Integration Status

✅ **COMPLETED** - Camoufox has been integrated:

1. **`src/scraper.ts`** ✅
   - `searchDirect()` uses Camoufox
   - `createFreshBrowser()` uses Camoufox
   - `searchBatch()` uses Camoufox
   - Maintains existing error handling

2. **`src/api.ts`** ✅
   - `initSession()` uses Camoufox
   - `quickSearch()` uses Camoufox
   - Direct API calls unchanged
   - Concurrent pool compatible

3. **Testing**
   - Ready for integration tests with proxy
   - Batch search tests should work with Camoufox
   - Error recovery tests should work with Camoufox

## Related Files

- `src/utils/proxy.ts` - Proxy utilities including `formatProxyForCamoufox()`
- `src/utils/proxy-provider.ts` - IPFoxy proxy fetcher
- `src/scraper.ts` - Main scraper (now uses Camoufox)
- `src/api.ts` - API client (now uses Camoufox for browser operations)
- `PROXY_DEBUG_NOTES.md` - Previous proxy debugging notes

## Notes

- Camoufox uses Firefox under the hood, which may behave differently than Chromium
- The `geoip: true` option should help with fingerprinting, but may not solve IP blocking
- IPFoxy proxies are HTTP proxies, not SOCKS5 (SOCKS5 auth not supported by Playwright)
- Previous attempts with Playwright showed similar issues (see `PROXY_DEBUG_NOTES.md`)

