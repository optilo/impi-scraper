/**
 * Unit tests for human behavior utilities
 */

import { describe, test, expect } from 'vitest';
import { randomDelay } from './human-behavior.ts';

describe('randomDelay', () => {
  test('delays within specified range', async () => {
    const start = Date.now();
    await randomDelay(50, 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    // Allow small scheduling overhead/drift
    expect(elapsed).toBeLessThanOrEqual(120);
  });
});

