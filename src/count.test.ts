import { describe, expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countTrademarks } from './api.ts';

function camoufoxVersionFile(): string {
  return path.join(os.homedir(), '.cache', 'camoufox', 'version.json');
}

async function ensureCamoufoxFetched(): Promise<void> {
  if (fs.existsSync(camoufoxVersionFile())) return;
  try {
    execSync('pnpm exec camoufox-js fetch', { stdio: 'inherit' });
  } catch {
    throw new Error('CAMOUFOX_FETCH_FAILED');
  }
}

async function ensureCamoufoxAvailable(): Promise<boolean> {
  try {
    await ensureCamoufoxFetched();
    return true;
  } catch (err: any) {
    if (err?.message === 'CAMOUFOX_FETCH_FAILED') {
      console.warn(
        'Skipping live count test: Camoufox browser not installed and fetch failed (likely no network).'
      );
      return false;
    }
    throw err;
  }
}

async function ensureNativeModulesReady(): Promise<boolean> {
  try {
    await import('better-sqlite3');
    return true;
  } catch (err: any) {
    if (err?.code === 'ERR_DLOPEN_FAILED') {
      try {
        execSync('pnpm rebuild better-sqlite3', { stdio: 'inherit' });
        await import('better-sqlite3');
        return true;
      } catch {
        console.warn(
          'Skipping live count test: better-sqlite3 native module mismatch and rebuild failed.'
        );
        return false;
      }
    }
    console.warn(`Skipping live count test: better-sqlite3 load failed (${err?.message ?? err}).`);
    return false;
  }
}

// Note: This test hits the real IMPI quick count endpoint.
// Keep the query generic and assert on shape to reduce flakiness.
describe('countTrademarks (live)', () => {
  test(
    'returns a positive count for a common keyword',
    async () => {
      const nativeReady = await ensureNativeModulesReady();
      if (!nativeReady) return;
      const camoufoxReady = await ensureCamoufoxAvailable();
      if (!camoufoxReady) return;

      try {
        const result = await countTrademarks('pacific', {
          headless: true,
          humanBehavior: false,
        });

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
      } catch (err: any) {
        if (err?.code === 'ERR_DLOPEN_FAILED') {
          console.warn('Skipping live count test: better-sqlite3 binary mismatch in CI runtime.');
          return;
        }
        throw err;
      }
    },
    90_000
  );
});
