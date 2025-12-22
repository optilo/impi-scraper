import { describe, expect, test, vi } from 'vitest';
import { countTrademarks, IMPIApiClient } from './api.ts';

describe('countTrademarks', () => {
  test('returns count and closes client', async () => {
    const getCountSpy = vi
      .spyOn(IMPIApiClient.prototype, 'getCount')
      .mockResolvedValue(123);
    const closeSpy = vi
      .spyOn(IMPIApiClient.prototype, 'close')
      .mockResolvedValue();

    const result = await countTrademarks('foo');

    expect(result).toBe(123);
    expect(getCountSpy).toHaveBeenCalledWith('foo');
    expect(closeSpy).toHaveBeenCalled();

    getCountSpy.mockRestore();
    closeSpy.mockRestore();
  });
});

