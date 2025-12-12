# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2025-12-12

### Changed

- **Human Behavior Optimization**: Significantly improved scraping performance
  - Removed automatic browser refresh on timeout - now only refreshes on actual crash/detection
  - Reduced all randomDelay values for faster execution
  - Simplified `addHumanBehavior()` to just set random viewport (removed blocking mouse movements)

- **Human Behavior Now Opt-In**: Changed `humanBehavior` default from `true` to `false`
  - CLI now uses `--human` flag to enable (instead of `--no-human` to disable)
  - Programmatic usage: `humanBehavior: true` to opt-in

## [1.1.0] - 2025-12-11

### Added

- **Proxy Support**: Route requests through HTTP/HTTPS/SOCKS5 proxies
  - New `proxy` option in `IMPIScraperOptions` with `server`, `username`, `password` fields
  - Auto-detection from environment variables: `IMPI_PROXY_URL`, `PROXY_URL`, `HTTP_PROXY`, `HTTPS_PROXY`
  - CLI flag `--proxy` / `-p` for command-line proxy configuration

- **External IP Detection**: Returns the IP address used for each request
  - New `externalIp` field in `SearchMetadata` response
  - Uses ipify.org and httpbin.org for IP detection
  - Useful for verifying proxy is working correctly

- **New utilities**: `src/utils/proxy.ts`
  - `parseProxyUrl()` - Parse proxy URL strings into ProxyConfig
  - `parseProxyFromEnv()` - Read proxy from environment variables
  - `resolveProxyConfig()` - Merge options and env var proxy config

- **New exports**: `parseProxyUrl`, `parseProxyFromEnv`, `resolveProxyConfig`, `ProxyConfig` type

### Changed

- CLI now displays external IP in table and summary output formats
- CLI shows proxy configuration on startup

## [1.0.0] - 2025-12-11

### Added

- Initial release
- Keyword search for IMPI trademarks
- Human-like behavior simulation (mouse movements, typing delays)
- Anti-detection measures
- Full details mode (owners, classes, history)
- CLI interface with multiple output formats (json, table, summary)
- TypeScript type definitions
- Unit and integration tests
