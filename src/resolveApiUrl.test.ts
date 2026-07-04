import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiUrlResolver, resolveSignalkApiUrl, SIGNALK_API_URL_OPTIONS } from './resolveApiUrl';

function mockFetchOkFor(...okUrls: string[]) {
  return async (url: string) => {
    if (okUrls.includes(url)) {
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }
    throw new TypeError('fetch failed');
  };
}

test('resolveSignalkApiUrl', async (t) => {
  await t.test('trusts and returns a configured URL once it responds to the probe', async () => {
    t.mock.method(globalThis, 'fetch', mockFetchOkFor('http://localhost:8080/signalk/v1/unitpreferences/categories'));
    assert.equal(await resolveSignalkApiUrl('http://localhost:8080'), 'http://localhost:8080');
  });

  await t.test('throws a specific error when a configured URL does not respond', async () => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(
      resolveSignalkApiUrl('http://localhost:9999'),
      /configured SignalK API base URL "http:\/\/localhost:9999" did not respond/,
    );
  });

  await t.test('probes SIGNALK_API_URL_OPTIONS in order and returns the first that responds', async () => {
    const [, second] = SIGNALK_API_URL_OPTIONS;
    t.mock.method(globalThis, 'fetch', mockFetchOkFor(`${second}/signalk/v1/unitpreferences/categories`));
    assert.equal(await resolveSignalkApiUrl(undefined), second);
  });

  await t.test('throws a generic error when none of SIGNALK_API_URL_OPTIONS respond', async () => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(resolveSignalkApiUrl(undefined), /could not reach this server's API on any of/);
  });
});

test('createApiUrlResolver', async (t) => {
  await t.test('memoizes a successful resolution across repeated calls', async () => {
    let fetchCalls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      fetchCalls++;
      if (url === `${SIGNALK_API_URL_OPTIONS[0]}/signalk/v1/unitpreferences/categories`) {
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }
      throw new TypeError('fetch failed');
    });
    const resolve = createApiUrlResolver(undefined);
    assert.equal(await resolve(), SIGNALK_API_URL_OPTIONS[0]);
    assert.equal(await resolve(), SIGNALK_API_URL_OPTIONS[0]);
    assert.equal(fetchCalls, 1);
  });

  await t.test('retries on the next call after a failed resolution instead of caching it', async () => {
    let succeed = false;
    t.mock.method(globalThis, 'fetch', async () => {
      if (succeed) {
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }
      throw new TypeError('fetch failed');
    });
    const resolve = createApiUrlResolver('http://localhost:3000');
    await assert.rejects(resolve());
    succeed = true;
    assert.equal(await resolve(), 'http://localhost:3000');
  });
});
