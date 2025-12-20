/**
 * Unit tests for human behavior utilities
 */

import { describe, test, expect } from 'vitest';
import { randomDelay, RateLimiter } from './human-behavior';

describe('randomDelay', () => {
  test('delays within specified range', async () => {
    const start = Date.now();
    await randomDelay(50, 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(150);
  });
});

describe('RateLimiter', () => {
  test('limits request rate', async () => {
    const limiter = new RateLimiter(100, 100);

    const start = Date.now();
    await limiter.waitIfNeeded();
    await limiter.waitIfNeeded();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(95);
  });

  test('does not delay first request', async () => {
    const limiter = new RateLimiter(1000, 1000);

    const start = Date.now();
    await limiter.waitIfNeeded();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
