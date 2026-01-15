/**
 * Proxy and IP detection utilities
 */
import type { Page } from 'playwright-core';
import type { ProxyConfig } from '../types.js';
/**
 * Detect external IP using browser request (uses proxy if configured)
 */
export declare function detectExternalIp(page: Page): Promise<string | null>;
/**
 * Parse proxy URL from environment variable
 * Supports formats:
 *   - http://host:port
 *   - http://user:pass@host:port
 *   - socks5://host:port
 */
export declare function parseProxyFromEnv(): ProxyConfig | undefined;
/**
 * Parse a proxy URL string into ProxyConfig
 */
export declare function parseProxyUrl(proxyUrl: string): ProxyConfig;
/**
 * Merge proxy config from options and environment
 * - ProxyConfig object: use that proxy
 * - undefined: fall back to environment variables
 */
export declare function resolveProxyConfig(optionsProxy?: ProxyConfig): ProxyConfig | undefined;
/**
 * Format proxy config for Camoufox
 * Camoufox expects: { server: 'http://host:port', username?, password? }
 */
export declare function formatProxyForCamoufox(proxy: ProxyConfig | undefined): any;
/**
 * Check if an error is a proxy-related error
 */
export declare function isProxyError(error: Error): boolean;
/**
 * Get a user-friendly message for proxy errors
 */
export declare function getProxyErrorMessage(error: Error, proxyServer?: string): string;
/**
 * Test if a proxy is reachable and working
 * Returns the external IP if successful, throws on failure
 */
export declare function testProxy(proxyConfig: ProxyConfig): Promise<string>;
//# sourceMappingURL=proxy.d.ts.map