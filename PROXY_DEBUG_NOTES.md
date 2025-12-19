# Proxy Debugging Notes - ERR_TUNNEL_CONNECTION_FAILED

## Issue Summary

When using IPFoxy proxies with Playwright to access `marcia.impi.gob.mx`, we get:
```
net::ERR_TUNNEL_CONNECTION_FAILED at https://marcia.impi.gob.mx/marcas/search/quick
```

## What Works

1. **curl with proxy** - Works perfectly:
   ```bash
   curl -x "http://user:pass@gate-sg.ipfoxy.io:58688" \
     -I "https://marcia.impi.gob.mx/marcas/search/quick"
   # Returns HTTP/2 200 with all cookies (JSESSIONID, SESSIONTOKEN, XSRF-TOKEN)
   ```

2. **Playwright without proxy** - Works perfectly:
   ```typescript
   await page.goto('https://marcia.impi.gob.mx/marcas/search/quick');
   // Status: 200, Cookies obtained successfully
   ```

3. **Playwright with proxy to other HTTPS sites** - Works:
   ```typescript
   // api.ipify.org - Works
   // google.com - Works
   // httpbin.org - Works
   ```

## What Doesn't Work

1. **Playwright + IPFoxy proxy + .gob.mx domains** - Fails:
   - `marcia.impi.gob.mx` - ERR_TUNNEL_CONNECTION_FAILED
   - `www.gob.mx` - ERR_TUNNEL_CONNECTION_FAILED

2. **All Playwright browsers fail** with proxy to IMPI:
   - Chromium (bundled)
   - Chrome (installed via channel)
   - Firefox - NS_ERROR_CONNECTION_REFUSED
   - WebKit - kCFErrorDomainCFNetwork error 310

3. **Crawlee ProxyConfiguration** - Same issue (uses Playwright under the hood)

## Tested Approaches (All Failed)

1. **Removing httpCredentials from context** - No effect
2. **ignoreHTTPSErrors: true** - No effect
3. **Different browser args** - No effect
4. **Embedded credentials in URL** - No effect
5. **SOCKS5 protocol** - Playwright doesn't support SOCKS5 auth

## Root Cause Analysis

The issue appears to be a known limitation with Playwright and certain proxy/site combinations:

1. **Browser Proxy Auth Handling**: Playwright delegates proxy auth to the browser. The browser waits for a 407 response before sending `Proxy-Authorization` header. Some proxy configurations may not behave as expected with this flow.

2. **Possible .gob.mx Infrastructure**: Mexican government domains may have specific TLS/connection requirements or be blocking connections from known proxy gateways.

3. **Known Playwright Issues**:
   - https://github.com/microsoft/playwright/issues/32567 (HTTP Proxy Authentication)
   - https://github.com/microsoft/playwright/issues/34252 (ERR_TUNNEL_CONNECTION_FAILED)

## Proxy Details (IPFoxy)

- **Gateway**: `gate-sg.ipfoxy.io:58688`
- **Protocol**: HTTP (SOCKS5 also available but auth not supported by Playwright)
- **Country Filter**: `cc-MX` in username gives Mexican IPs
- **IP Example**: 189.168.199.154 (UNINET, Durango, Mexico)

## Possible Next Steps

1. **Try different IPFoxy gateway**:
   - Check if there's a non-SG gateway (gate-us, gate-eu, etc.)
   - Try without country filter (`cc-MX`) to get non-Mexican IPs

2. **Contact IPFoxy support**:
   - Ask about Playwright compatibility
   - Ask about specific .gob.mx access issues

3. **Alternative proxy providers**:
   - BrightData, Oxylabs, or SmartProxy may work better with Playwright

4. **Hybrid approach**:
   - Use Playwright without proxy for session initialization
   - Use proxied `fetch()` calls for API requests (similar to how `apiFetch` works)

5. **Local proxy tunnel**:
   - Run a local proxy server that handles auth
   - Point Playwright to localhost proxy
   - Local proxy forwards to IPFoxy

## Current Status

The concurrent pool feature (`IMPIConcurrentPool`) is implemented but cannot work with IPFoxy proxies for IMPI access. The single-worker non-proxy path works correctly.

**Date**: 2025-12-13
