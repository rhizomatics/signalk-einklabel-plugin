import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchJson, setAllowSelfSignedCertificates } from "./httpJson";

function fakeResponse(overrides: Partial<Response>): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({}),
    text: async () => "",
    ...overrides,
  } as unknown as Response;
}

test("fetchJson", async (t) => {
  await t.test("resolves the parsed JSON body on a 2xx response", async () => {
    t.mock.method(globalThis, "fetch", async () => fakeResponse({ json: async () => ({ hello: "world" }) }));
    assert.deepEqual(await fetchJson("http://example.com"), { hello: "world" });
  });

  await t.test("rejects with the URL, status and body on a non-ok response", async () => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "no such resource",
      }),
    );
    await assert.rejects(
      fetchJson("http://example.com/missing"),
      /fetch failed: http:\/\/example\.com\/missing \(404 Not Found\) - no such resource/,
    );
  });

  await t.test("omits the trailing detail when the error body is empty", async () => {
    t.mock.method(globalThis, "fetch", async () => fakeResponse({ ok: false, status: 500, statusText: "Internal Server Error" }));
    await assert.rejects(fetchJson("http://example.com"), /^Error: fetch failed: http:\/\/example\.com \(500 Internal Server Error\)$/);
  });

  await t.test("falls back to an empty body when reading the error response text itself fails", async () => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeResponse({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => {
          throw new Error("stream already consumed");
        },
      }),
    );
    await assert.rejects(fetchJson("http://example.com"), /^Error: fetch failed: http:\/\/example\.com \(503 Service Unavailable\)$/);
  });

  await t.test("unwraps a network error whose cause is a plain Error", async () => {
    t.mock.method(globalThis, "fetch", async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = new Error("connect ECONNREFUSED 127.0.0.1:3000");
      throw err;
    });
    await assert.rejects(fetchJson("http://localhost:3000"), /fetch failed: http:\/\/localhost:3000 - connect ECONNREFUSED/);
  });

  await t.test("falls back to an Error cause's code when it has no message", async () => {
    t.mock.method(globalThis, "fetch", async () => {
      const err = new TypeError("fetch failed");
      const cause = new Error("");
      (cause as NodeJS.ErrnoException).code = "ECONNREFUSED";
      (err as unknown as { cause: unknown }).cause = cause;
      throw err;
    });
    await assert.rejects(fetchJson("http://localhost:3000"), /fetch failed: http:\/\/localhost:3000 - ECONNREFUSED/);
  });

  await t.test("joins multiple causes from an AggregateError-shaped cause (IPv6+IPv4 dual-stack failure)", async () => {
    t.mock.method(globalThis, "fetch", async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = {
        errors: [new Error("connect ECONNREFUSED ::1:3000"), new Error("connect ECONNREFUSED 127.0.0.1:3000")],
      };
      throw err;
    });
    await assert.rejects(
      fetchJson("http://localhost:3000"),
      /fetch failed: http:\/\/localhost:3000 - connect ECONNREFUSED ::1:3000; connect ECONNREFUSED 127\.0\.0\.1:3000/,
    );
  });

  await t.test("falls back to the raw cause value when it is neither an Error nor an array", async () => {
    t.mock.method(globalThis, "fetch", async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: unknown }).cause = "some non-error cause";
      throw err;
    });
    await assert.rejects(fetchJson("http://localhost:3000"), /fetch failed: http:\/\/localhost:3000 - some non-error cause/);
  });

  await t.test("falls back to the error message when there is no cause at all", async () => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("totally unexpected failure");
    });
    await assert.rejects(fetchJson("http://localhost:3000"), /fetch failed: http:\/\/localhost:3000 - totally unexpected failure/);
  });
});

test("fetchJson names the self-signed setting on a certificate failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: unknown }).cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    throw err;
  });
  await assert.rejects(fetchJson("https://localhost:3443"), /self-signed certificate - .*"Allow self-signed certificates"/);
});

async function listen(handler: RequestListener): Promise<{ server: Server; base: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("fetchJson with self-signed certificates allowed", async (t) => {
  setAllowSelfSignedCertificates(true);
  t.after(() => setAllowSelfSignedCertificates(false));

  await t.test("follows a redirect and parses the JSON body", async () => {
    const { server, base } = await listen((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/end" }).end();
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ hello: "world" }));
      }
    });
    try {
      assert.deepEqual(await fetchJson(`${base}/start`), { hello: "world" });
    } finally {
      server.close();
    }
  });

  await t.test("rejects with the original URL, status and body on a non-2xx response", async () => {
    const { server, base } = await listen((_req, res) => res.writeHead(404, "Not Found").end("no such resource"));
    try {
      await assert.rejects(
        fetchJson(`${base}/missing`),
        /fetch failed: http:\/\/127\.0\.0\.1:\d+\/missing \(404 Not Found\) - no such resource/,
      );
    } finally {
      server.close();
    }
  });

  await t.test("gives up on a redirect loop", async () => {
    const { server, base } = await listen((_req, res) => res.writeHead(302, { location: "/loop" }).end());
    try {
      await assert.rejects(fetchJson(`${base}/loop`), /more than 5 redirects/);
    } finally {
      server.close();
    }
  });

  await t.test("reports a connection failure with the underlying cause", async () => {
    const { server, base } = await listen((_req, res) => res.end());
    server.close();
    await assert.rejects(fetchJson(base), /fetch failed: http:\/\/127\.0\.0\.1:\d+ - .*ECONNREFUSED/);
  });
});
