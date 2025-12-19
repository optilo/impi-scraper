/**
 * Proxy and IP detection utilities
 */

import type { Page } from 'playwright';
import type { ProxyConfig } from '../types';

/**
 * IP check services (in order of preference)
 */
const IP_CHECK_SERVICES = [
  { url: 'https://api.ipify.org?format=json', parser: (data: any) => data.ip },
  { url: 'https://httpbin.org/ip', parser: (data: any) => data.origin },
  { url: 'https://api.myip.com', parser: (data: any) => data.ip },
];

/**
 * Detect external IP using browser request (uses proxy if configured)
 */
export async function detectExternalIp(page: Page): Promise<string | null> {
  for (const service of IP_CHECK_SERVICES) {
    try {
      const response = await page.request.get(service.url, {
        timeout: 10000,
      });

      if (response.ok()) {
        const data = await response.json();
        const ip = service.parser(data);
        if (ip && typeof ip === 'string') {
          return ip.split(',')[0]!.trim(); // Handle multiple IPs (X-Forwarded-For)
        }
      }
    } catch {
      // Try next service
      continue;
    }
  }

  return null;
}

/**
 * Parse proxy URL from environment variable
 * Supports formats:
 *   - http://host:port
 *   - http://user:pass@host:port
 *   - socks5://host:port
 */
export function parseProxyFromEnv(): ProxyConfig | undefined {
  // Check multiple common env var names for the full proxy URL (includes auth)
  const proxyUrl = process.env.IMPI_PROXY_URL
    || process.env.PROXY_URL
    || process.env.HTTP_PROXY
    || process.env.HTTPS_PROXY;

  if (proxyUrl) {
    return parseProxyUrl(proxyUrl);
  }

  // Check for separate server/username/password env vars
  const proxyServer = process.env.PROXY_SERVER;
  if (proxyServer) {
    const config = parseProxyUrl(proxyServer);
    // Override with separate username/password if provided
    const username = process.env.PROXY_USERNAME || process.env.PROXY_USER;
    const password = process.env.PROXY_PASSWORD || process.env.PROXY_PASS;
    if (username) config.username = username;
    if (password) config.password = password;
    return config;
  }

  return undefined;
}

/**
 * Parse a proxy URL string into ProxyConfig
 */
export function parseProxyUrl(proxyUrl: string): ProxyConfig {
  // Add protocol if missing for URL parsing
  const urlToParse = proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`;

  try {
    const url = new URL(urlToParse);

    // Build server URL with port if present
    const port = url.port ? `:${url.port}` : '';
    const server = `${url.protocol}//${url.hostname}${port}`;

    return {
      server,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  } catch {
    // If URL parsing fails, return as-is with http prefix
    return {
      server: urlToParse,
    };
  }
}

/**
 * Merge proxy config from options and environment
 * - ProxyConfig object: use that proxy
 * - null: explicitly disable proxy (no env fallback)
 * - undefined: fall back to environment variables
 */
export function resolveProxyConfig(optionsProxy?: ProxyConfig | null): ProxyConfig | undefined {
  // Explicit null means "no proxy" - don't fall back to env vars
  if (optionsProxy === null) {
    return undefined;
  }

  // Explicit proxy config takes precedence
  if (optionsProxy) {
    return optionsProxy;
  }

  // Fall back to environment variable
  return parseProxyFromEnv();
}

/**
 * Format proxy config for Camoufox
 * Camoufox expects: { server: 'http://host:port', username?, password? }
 */
export function formatProxyForCamoufox(proxy: ProxyConfig | undefined): any {
  if (!proxy) return undefined;

  // Ensure server has protocol
  let server = proxy.server;
  if (!server.includes('://')) {
    server = `http://${server}`;
  }

  return {
    server,
    username: proxy.username,
    password: proxy.password,
  };
}

/**
 * Check if an error is a proxy-related error
 */
export function isProxyError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('err_tunnel_connection_failed') ||
         message.includes('err_proxy_connection_failed') ||
         message.includes('proxy') ||
         message.includes('407');
}

/**
 * Get a user-friendly message for proxy errors
 */
export function getProxyErrorMessage(error: Error, proxyServer?: string): string {
  const message = error.message;

  if (message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
    return `Proxy tunnel failed${proxyServer ? ` (${proxyServer})` : ''}: Cannot establish connection.\n` +
      `   Possible causes: credentials expired, proxy down, account suspended, or firewall blocking.`;
  }
  if (message.includes('ERR_PROXY_CONNECTION_FAILED')) {
    return `Proxy unreachable${proxyServer ? ` (${proxyServer})` : ''}: Cannot connect to proxy server.`;
  }
  if (message.includes('407') || message.includes('Proxy Authentication Required')) {
    return `Proxy authentication failed${proxyServer ? ` (${proxyServer})` : ''}: Check credentials.`;
  }
  if (message.includes('ECONNREFUSED')) {
    return `Proxy connection refused${proxyServer ? ` (${proxyServer})` : ''}: Server not accepting connections.`;
  }
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
    return `Proxy timeout${proxyServer ? ` (${proxyServer})` : ''}: Connection timed out.`;
  }

  return `Proxy error: ${message}`;
}

/**
 * Test if a proxy is reachable and working
 * Returns the external IP if successful, throws on failure
 */
export async function testProxy(proxyConfig: ProxyConfig): Promise<string> {
  const { chromium } = await import('playwright');

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: {
        server: proxyConfig.server,
        username: proxyConfig.username,
        password: proxyConfig.password,
      },
      timeout: 30000,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Try multiple IP detection services
    const ipServices = [
      { url: 'http://httpbin.org/ip', parser: (text: string) => JSON.parse(text).origin?.split(',')[0]?.trim() },
      { url: 'http://ip-api.com/json', parser: (text: string) => JSON.parse(text).query },
      { url: 'http://api.ipify.org', parser: (text: string) => text.trim() },
      { url: 'https://api.ipify.org', parser: (text: string) => text.trim() },
    ];

    for (const service of ipServices) {
      try {
        const response = await page.goto(service.url, { timeout: 10000 });
        if (response && response.ok()) {
          const text = await page.textContent('body');
          if (text) {
            const ip = service.parser(text);
            if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
              return ip;
            }
          }
        }
      } catch {
        // Try next service
        continue;
      }
    }

    throw new Error('Could not detect external IP through proxy - all IP detection services failed');
  } catch (err) {
    const message = (err as Error).message;

    if (message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
      throw new Error(`Proxy tunnel failed: Cannot establish connection through ${proxyConfig.server}.\n` +
        `   Possible causes:\n` +
        `   - Proxy credentials expired or invalid\n` +
        `   - Proxy server is down or unreachable\n` +
        `   - Proxy account has been suspended\n` +
        `   - Network/firewall blocking connection to proxy port`);
    }
    if (message.includes('ERR_PROXY_CONNECTION_FAILED')) {
      throw new Error(`Proxy unreachable: Cannot connect to ${proxyConfig.server}.\n` +
        `   Check network settings and firewall configuration.`);
    }
    if (message.includes('407') || message.includes('Proxy Authentication Required')) {
      throw new Error(`Proxy authentication failed: ${proxyConfig.server} rejected credentials.\n` +
        `   Check username and password are correct and not expired.`);
    }
    if (message.includes('ERR_PROXY_CERTIFICATE_INVALID')) {
      throw new Error(`Proxy certificate invalid: ${proxyConfig.server} has an invalid SSL certificate.`);
    }
    if (message.includes('ECONNREFUSED')) {
      throw new Error(`Proxy connection refused: ${proxyConfig.server} is not accepting connections.\n` +
        `   The proxy server may be down or the port may be wrong.`);
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      throw new Error(`Proxy timeout: Connection to ${proxyConfig.server} timed out.\n` +
        `   The proxy server may be slow or unreachable.`);
    }

    throw new Error(`Proxy error: ${message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
