import { vi } from 'vitest';
import type { TracesAPI } from '../../src/common/api/traces';

export function createMockTracesAPI(): TracesAPI {
  return {
    listTraces: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 }),
    getTrace: vi.fn().mockResolvedValue(null),
    getSpans: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 }),
  } as unknown as TracesAPI;
}
