/**
 * Proxy Provider API Integration
 *
 * Supports fetching fresh proxy IPs from rotating proxy providers.
 * Currently supports: IPFoxy
 */
import type { ProxyConfig } from '../types.js';
export interface ProxyProviderConfig {
    provider: 'ipfoxy';
    apiToken: string;
    host?: string;
    port?: number;
    country?: string;
}
export interface ProxyProviderResult {
    proxies: ProxyConfig[];
    count: number;
    provider: string;
}
/**
 * Fetch fresh proxy IPs from IPFoxy API
 */
export declare function fetchIPFoxyProxies(config: ProxyProviderConfig, count?: number): Promise<ProxyProviderResult>;
/**
 * Parse proxy provider config from environment variables
 */
export declare function parseProxyProviderFromEnv(): ProxyProviderConfig | undefined;
/**
 * Fetch proxies from configured provider
 */
export declare function fetchProxies(config: ProxyProviderConfig, count?: number): Promise<ProxyProviderResult>;
/**
 * Convenience function to fetch proxies from env config
 */
export declare function fetchProxiesFromEnv(count?: number): Promise<ProxyProviderResult | null>;
//# sourceMappingURL=proxy-provider.d.ts.map