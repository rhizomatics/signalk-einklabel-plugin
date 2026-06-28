import test from 'node:test';
import assert from 'node:assert/strict';
import { findBindings, parseBinding, renderBinding, resolveBinding } from './binding';
import { TemplateContext } from './types';

test('parseBinding', async (t) => {
  await t.test('bare path is shorthand for source=signalk,context=self', () => {
    assert.deepEqual(parseBinding('navigation.speedOverGround'), {
      source: 'signalk',
      context: 'self',
      path: 'navigation.speedOverGround',
    });
  });

  await t.test('parses key=value pairs', () => {
    assert.deepEqual(parseBinding('source=resources,resource=tides,path=extremes.[0].level,category=depth,round=2'), {
      source: 'resources',
      context: 'self',
      resource: 'tides',
      path: 'extremes.[0].level',
      format: undefined,
      category: 'depth',
      round: 2,
    });
  });

  await t.test('rejects an unknown key', () => {
    assert.throws(() => parseBinding('bogus=1,path=a'), /unknown key "bogus"/);
  });

  await t.test('rejects a pair with no "="', () => {
    assert.throws(() => parseBinding('path'), /expected "key=value" pairs/);
  });

  await t.test('rejects an unknown source', () => {
    assert.throws(() => parseBinding('source=ftp,path=a'), /unknown source "ftp"/);
  });

  await t.test('source=resources requires a resource key', () => {
    assert.throws(() => parseBinding('source=resources,path=a'), /requires a "resource" key/);
  });

  await t.test('requires a path key', () => {
    assert.throws(() => parseBinding('source=signalk'), /missing required "path" key/);
  });
});

test('findBindings extracts every <text><desc> binding from SVG source', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <text>one<desc>path=a.b</desc></text>
    <text>two<desc>path=c.d</desc></text>
    <text>no binding here</text>
  </svg>`;
  assert.deepEqual(
    findBindings(svg).map((b) => b.path),
    ['a.b', 'c.d'],
  );
});

test('resolveBinding', async (t) => {
  const context: TemplateContext = {
    signalk: { self: { navigation: { speedOverGround: 3.5 } } },
    resources: { tides: { extremes: [{ level: 1.2 }] } },
  };

  await t.test('reads a signalk-sourced binding from the given context', () => {
    assert.equal(resolveBinding(parseBinding('navigation.speedOverGround'), context), 3.5);
  });

  await t.test('supports both array index notations', () => {
    assert.equal(resolveBinding(parseBinding('source=resources,resource=tides,path=extremes.[0].level'), context), 1.2);
    assert.equal(resolveBinding(parseBinding('source=resources,resource=tides,path=extremes[0].level'), context), 1.2);
  });

  await t.test('throws when the signalk context is missing', () => {
    assert.throws(
      () => resolveBinding(parseBinding('source=signalk,context=urn:mrn:imo:mmsi:1,path=a'), context),
      /context "urn:mrn:imo:mmsi:1" which is not present/,
    );
  });

  await t.test('throws when the resource is missing', () => {
    assert.throws(
      () => resolveBinding(parseBinding('source=resources,resource=waypoints,path=a'), context),
      /resource "waypoints" which is not present/,
    );
  });
});

test('renderBinding', async (t) => {
  await t.test('rounds a plain number with no displayUnits/category', () => {
    const context: TemplateContext = { signalk: { self: { a: 3.14159 } } };
    assert.equal(renderBinding(parseBinding('path=a,round=2'), context), '3.14');
  });

  await t.test('auto-converts using pathMeta displayUnits when present', () => {
    const context: TemplateContext = {
      signalk: { self: { a: 10 } },
      pathMeta: { self: { a: { displayUnits: { category: 'speed', targetUnit: 'kn', formula: 'value * 1.94384', symbol: 'kn' } } } },
    };
    assert.equal(renderBinding(parseBinding('path=a,round=1'), context), '19.4kn');
  });

  await t.test('format=raw opts out of automatic unit conversion', () => {
    const context: TemplateContext = {
      signalk: { self: { a: 10 } },
      pathMeta: { self: { a: { displayUnits: { category: 'speed', targetUnit: 'kn', formula: 'value * 1.94384', symbol: 'kn' } } } },
    };
    assert.equal(renderBinding(parseBinding('path=a,format=raw,round=1'), context), '10.0');
  });

  await t.test('null/undefined render as an empty string', () => {
    const context: TemplateContext = { signalk: { self: { a: null } } };
    assert.equal(renderBinding(parseBinding('path=a'), context), '');
  });

  await t.test('an unformatted object renders as JSON', () => {
    const context: TemplateContext = { signalk: { self: { a: { x: 1 } } } };
    assert.equal(renderBinding(parseBinding('path=a'), context), '{"x":1}');
  });

  await t.test('falls through to String() for anything else', () => {
    const context: TemplateContext = { signalk: { self: { a: true } } };
    assert.equal(renderBinding(parseBinding('path=a'), context), 'true');
  });
});
