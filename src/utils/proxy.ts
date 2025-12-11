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
          return ip.split(',')[0].trim(); // Handle multiple IPs (X-Forwarded-For)
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
  // Check multiple common env var names
  const proxyUrl = process.env.IMPI_PROXY_URL
    || process.env.PROXY_URL
    || process.env.HTTP_PROXY
    || process.env.HTTPS_PROXY;

  if (!proxyUrl) {
    return undefined;
  }

  return parseProxyUrl(proxyUrl);
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
 * Options take precedence over env vars
 */
export function resolveProxyConfig(optionsProxy?: ProxyConfig): ProxyConfig | undefined {
  // Explicit options take precedence
  if (optionsProxy) {
    return optionsProxy;
  }

  // Fall back to environment variable
  return parseProxyFromEnv();
}
