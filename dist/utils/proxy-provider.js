/**
 * Proxy Provider API Integration
 *
 * Supports fetching fresh proxy IPs from rotating proxy providers.
 * Currently supports: IPFoxy
 */
/**
 * Fetch fresh proxy IPs from IPFoxy API
 */
export async function fetchIPFoxyProxies(config, count = 1) {
    const host = config.host || 'gate-sg.ipfoxy.io';
    const port = config.port || 58688;
    // Build API URL - use JSON format for structured response
    const params = new URLSearchParams({
        count: count.toString(),
        host,
        port: port.toString(),
        type: 'json',
        token: config.apiToken,
        period: '0',
    });
    const apiUrl = `https://api.ipfoxy.com/ip/dynamic-api/ips?${params}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`IPFoxy API error (${response.status}): ${text}`);
        }
        const json = (await response.json());
        // Check API response code
        if (json.code !== 0) {
            throw new Error(`IPFoxy API error (code ${json.code}): ${json.msg}`);
        }
        if (!json.data || json.data.length === 0) {
            throw new Error('IPFoxy API returned no proxies - check your account balance and API token');
        }
        // Parse JSON response into ProxyConfig array
        // Each item has a unique session ID in the username for IP rotation
        const proxies = json.data.map(item => ({
            server: `http://${item.host}:${item.port}`,
            username: item.user,
            password: item.password,
        }));
        return {
            proxies,
            count: proxies.length,
            provider: 'ipfoxy',
        };
    }
    catch (err) {
        if (err.message.includes('IPFoxy')) {
            throw err;
        }
        throw new Error(`Failed to fetch proxies from IPFoxy: ${err.message}`);
    }
}
/**
 * Parse proxy provider config from environment variables
 */
export function parseProxyProviderFromEnv() {
    const apiToken = process.env.IPFOXY_API_TOKEN || process.env.IPFOXY_TOKEN;
    if (!apiToken) {
        return undefined;
    }
    return {
        provider: 'ipfoxy',
        apiToken,
        host: process.env.IPFOXY_HOST || 'gate-sg.ipfoxy.io',
        port: process.env.IPFOXY_PORT ? parseInt(process.env.IPFOXY_PORT, 10) : 58688,
        country: process.env.IPFOXY_COUNTRY,
    };
}
/**
 * Fetch proxies from configured provider
 */
export async function fetchProxies(config, count = 1) {
    switch (config.provider) {
        case 'ipfoxy':
            return fetchIPFoxyProxies(config, count);
        default:
            throw new Error(`Unknown proxy provider: ${config.provider}`);
    }
}
/**
 * Convenience function to fetch proxies from env config
 */
export async function fetchProxiesFromEnv(count = 1) {
    const config = parseProxyProviderFromEnv();
    if (!config) {
        return null;
    }
    return fetchProxies(config, count);
}
//# sourceMappingURL=proxy-provider.js.map