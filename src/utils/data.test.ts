/**
 * Unit tests for data utilities
 */

import { describe, test, expect } from 'bun:test';
import { parseDate, sanitizeFilename, sleep } from './data';

describe('parseDate', () => {
  test('parses DD/MM/YYYY format correctly', () => {
    expect(parseDate('12/02/2002')).toBe('2002-02-12');
    expect(parseDate('26/03/2002')).toBe('2002-03-26');
  });

  test('pads single digit day and month', () => {
    expect(parseDate('1/2/2020')).toBe('2020-02-01');
    expect(parseDate('5/9/2021')).toBe('2021-09-05');
  });

  test('handles null and undefined', () => {
    expect(parseDate(null)).toBe(null);
    expect(parseDate(undefined)).toBe(null);
    expect(parseDate('')).toBe(null);
  });

  test('handles invalid format', () => {
    expect(parseDate('invalid')).toBe(null);
    expect(parseDate('2020-01-01')).toBe(null);
    expect(parseDate('01/02')).toBe(null);
  });
});

describe('sanitizeFilename', () => {
  test('removes invalid characters', () => {
    expect(sanitizeFilename('test<>:file')).toBe('testfile');
    expect(sanitizeFilename('test/\\file')).toBe('testfile');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeFilename('test file name')).toBe('test_file_name');
  });

  test('handles Spanish characters', () => {
    expect(sanitizeFilename('año')).toBe('ano');
    expect(sanitizeFilename('SEÑOR')).toBe('SENOR');
  });

  test('removes multiple underscores', () => {
    expect(sanitizeFilename('test___file')).toBe('test_file');
  });

  test('removes leading/trailing underscores', () => {
    expect(sanitizeFilename('_test_')).toBe('test');
  });

  test('limits length to 200 characters', () => {
    const longName = 'a'.repeat(250);
    expect(sanitizeFilename(longName).length).toBe(200);
  });
});

describe('sleep', () => {
  test('delays for specified time', async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(150);
  });
});
