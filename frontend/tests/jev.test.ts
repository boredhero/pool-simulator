import { afterEach, expect, it, vi } from 'vitest';
import { jevRequest } from '../src/sim/jev';

afterEach(() => vi.unstubAllGlobals());

it('uses authenticated same-origin game endpoints and passes cancellation', async () => {
  const id = '0123456789abcdef01234567';
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'game' }, {
    headers: { 'X-Request-ID': id },
  }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  expect(await jevRequest('/games', {}, controller.signal)).toEqual({ id: 'game', diagnosticId: id });
  expect(fetcher.mock.calls[0][0]).toBe('/api/opponents/jev/games');
  expect(fetcher.mock.calls[0][1].headers['X-Pool-Request']).toBe('1');
  controller.abort();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});

it.each([null, 'invalid diagnostic header'])('handles a missing or invalid diagnostic ID (%s)', async (id) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'game' }, {
    headers: id ? { 'X-Request-ID': id } : {},
  })));
  expect(await jevRequest('/games', {}, new AbortController().signal)).toEqual({
    id: 'game', diagnosticId: null,
  });
});

it.each([401, 429])('preserves server errors without a diagnostic header (HTTP %s)', async (status) => {
  const detail = status === 401 ? 'Sign in first.' : 'Monthly allowance used.';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail }, { status })));
  await expect(jevRequest('/games', {}, new AbortController().signal)).rejects.toThrow(detail);
});

it('attaches the server diagnostic ID to errors', async () => {
  const id = '0123456789abcdef01234567';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Try again.' }, {
    status: 500, headers: { 'X-Request-ID': id },
  })));
  await expect(jevRequest('/games', {}, new AbortController().signal))
    .rejects.toThrow(`Try again. · Diagnostic ID: ${id}`);
});
