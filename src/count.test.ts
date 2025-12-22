import { describe, expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { countTrademarks } from './api.ts';

async function ensureNativeModulesReady(): Promise<void> {
  try {
    await import('better-sqlite3');
    return;
  } catch (err: any) {
    if (err?.code === 'ERR_DLOPEN_FAILED') {
      try {
        execSync('pnpm rebuild better-sqlite3', { stdio: 'inherit' });
        await import('better-sqlite3');
        return;
      } catch {
        throw new Error(
          'better-sqlite3 native module mismatch. Run `pnpm rebuild better-sqlite3` with your current Node version.'
        );
      }
    }
    throw err;
  }
}

// Note: This test hits the real IMPI quick count endpoint.
// Keep the query generic and assert on shape to reduce flakiness.
describe('countTrademarks (live)', () => {
  test(
    'returns a positive count for a common keyword',
    async () => {
      await ensureNativeModulesReady();

      const result = await countTrademarks('pacific', {
        headless: true,
        humanBehavior: false,
      });

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    },
    90_000
  );
});
