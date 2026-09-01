import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLabelContext,
  findBindings,
  findTextBindings,
  parseBinding,
  readTemplateDimensions,
  renderBinding,
  resolveBinding,
  resourceContextKey,
  substituteTextBindings,
} from "./binding";
import { TemplateContext } from "./types";

test("parseBinding", async (t) => {
  await t.test("bare path is shorthand for source=signalk,context=self", () => {
    assert.deepEqual(parseBinding("navigation.speedOverGround"), {
      source: "signalk",
      context: "self",
      path: "navigation.speedOverGround",
    });
  });

  await t.test("parses key=value pairs", () => {
    assert.deepEqual(parseBinding("source=resources,resource=tides,path=extremes[0].level,category=depth,round=2"), {
      source: "resources",
      context: "self",
      resource: "tides",
      provider: undefined,
      path: "extremes[0].level",
      format: undefined,
      category: "depth",
      round: 2,
      assets: undefined,
      default: undefined,
    });
  });

  await t.test("parses an optional default key", () => {
    assert.equal(parseBinding("path=a,default=n/a").default, "n/a");
  });

  await t.test("an explicit empty default still counts as given, not unset", () => {
    assert.equal(parseBinding("path=a,default=").default, "");
  });

  await t.test("parses an optional provider key, to pin a specific resource provider", () => {
    assert.equal(parseBinding("source=resources,resource=tides,provider=tides,path=station.name").provider, "tides");
  });

  await t.test("rejects a provider key on a non-resources source", () => {
    assert.throws(() => parseBinding("source=signalk,provider=tides,path=a"), /"provider" is only valid with source=resources/);
  });

  await t.test("rejects an unknown key", () => {
    assert.throws(() => parseBinding("bogus=1,path=a"), /unknown key "bogus"/);
  });

  await t.test('rejects a pair with no "="', () => {
    assert.throws(() => parseBinding("source=signalk,bogus"), /expected "key=value" pairs/);
  });

  await t.test("rejects an unknown source", () => {
    assert.throws(() => parseBinding("source=ftp,path=a"), /unknown source "ftp"/);
  });

  await t.test("source=resources requires a resource key", () => {
    assert.throws(() => parseBinding("source=resources,path=a"), /requires a "resource" key/);
  });

  await t.test("requires a path key", () => {
    assert.throws(() => parseBinding("source=signalk"), /missing required "path" key/);
  });
});

test("resourceContextKey", async (t) => {
  await t.test("is the bare resource name when no provider is pinned", () => {
    assert.equal(resourceContextKey({ resource: "tides", provider: undefined }), "tides");
  });

  await t.test("incorporates the provider when one is pinned", () => {
    assert.equal(resourceContextKey({ resource: "tides", provider: "tides" }), "tides@tides");
  });
});

test("findBindings extracts every <text><desc> and <image><desc> binding from SVG source", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <text>one<desc>path=a.b</desc></text>
    <text>two<desc>path=c.d</desc></text>
    <text>no binding here</text>
    <image><desc>path=e.f,assets=icons</desc></image>
    <image />
  </svg>`;
  assert.deepEqual(
    findBindings(svg).map((b) => b.path),
    ["a.b", "c.d", "e.f"],
  );
});

test("readTemplateDimensions", async (t) => {
  await t.test("reads width/height off the root <svg> element", () => {
    assert.deepEqual(readTemplateDimensions('<svg xmlns="http://www.w3.org/2000/svg" width="250" height="128"></svg>'), {
      width: 250,
      height: 128,
    });
  });

  await t.test("falls back to viewBox when width/height are missing", () => {
    assert.deepEqual(readTemplateDimensions('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 416 240"></svg>'), {
      width: 416,
      height: 240,
    });
  });

  await t.test("returns undefined for whichever of width/height isn't declared anywhere", () => {
    assert.deepEqual(readTemplateDimensions('<svg xmlns="http://www.w3.org/2000/svg" width="250"></svg>'), {
      width: 250,
      height: undefined,
    });
  });

  await t.test("returns an empty result when there is no root <svg> element", () => {
    assert.deepEqual(readTemplateDimensions("<not-svg/>"), {});
  });
});

test("resolveBinding", async (t) => {
  const context: TemplateContext = {
    signalk: { self: { navigation: { speedOverGround: 3.5 } } },
    resources: { tides: { extremes: [{ level: 1.2 }] } },
  };

  await t.test("reads a signalk-sourced binding from the given context", () => {
    assert.equal(resolveBinding(parseBinding("navigation.speedOverGround"), context), 3.5);
  });

  await t.test("supports both array index notations", () => {
    assert.equal(resolveBinding(parseBinding("source=resources,resource=tides,path=extremes[0].level"), context), 1.2);
    assert.equal(resolveBinding(parseBinding("source=resources,resource=tides,path=extremes[0].level"), context), 1.2);
  });

  await t.test("throws when the signalk context is missing", () => {
    assert.throws(
      () => resolveBinding(parseBinding("source=signalk,context=urn:mrn:imo:mmsi:1,path=a"), context),
      /context "urn:mrn:imo:mmsi:1" which is not present/,
    );
  });

  await t.test("throws when the resource is missing", () => {
    assert.throws(
      () => resolveBinding(parseBinding("source=resources,resource=waypoints,path=a"), context),
      /resource "waypoints" which is not present/,
    );
  });

  await t.test("a provider= binding is keyed separately from an unpinned binding for the same resource type", () => {
    const providerContext: TemplateContext = {
      ...context,
      resources: { tides: { extremes: [{ level: 1.2 }] }, "tides@tides": { extremes: [{ level: 9.9 }] } },
    };
    assert.equal(resolveBinding(parseBinding("source=resources,resource=tides,path=extremes[0].level"), providerContext), 1.2);
    assert.equal(
      resolveBinding(parseBinding("source=resources,resource=tides,provider=tides,path=extremes[0].level"), providerContext),
      9.9,
    );
  });

  await t.test("throws referencing the provider-qualified key when a pinned resource is missing", () => {
    assert.throws(
      () => resolveBinding(parseBinding("source=resources,resource=tides,provider=other,path=a"), context),
      /resource "tides@other" which is not present/,
    );
  });

  await t.test("reads an einklabel-sourced binding from context.meta", () => {
    const metaContext: TemplateContext = {
      ...context,
      meta: { repainted: "2026-06-21T18:05:00Z" },
    };
    assert.equal(resolveBinding(parseBinding("source=einklabel,path=repainted"), metaContext), "2026-06-21T18:05:00Z");
  });

  await t.test("throws when no meta is present in the render context", () => {
    assert.throws(
      () => resolveBinding(parseBinding("source=einklabel,path=repainted"), context),
      /source "einklabel" but no "meta" is present/,
    );
  });

  await t.test("reads a label-sourced binding from context.label", () => {
    const labelContext: TemplateContext = { ...context, label: { width: 416, manufacturer: "zhsunyco" } };
    assert.equal(resolveBinding(parseBinding("source=label,path=width"), labelContext), 416);
    assert.equal(resolveBinding(parseBinding("source=label,path=manufacturer"), labelContext), "zhsunyco");
  });

  await t.test("throws when no label is present in the render context", () => {
    assert.throws(() => resolveBinding(parseBinding("source=label,path=width"), context), /source "label" but no "label" is present/);
  });
});

test("renderBinding", async (t) => {
  await t.test("rounds a plain number with no displayUnits/category", () => {
    const context: TemplateContext = { signalk: { self: { a: 3.14159 } } };
    assert.equal(renderBinding(parseBinding("path=a,round=2"), context), "3.14");
  });

  await t.test("auto-converts using pathMeta displayUnits when present", () => {
    const context: TemplateContext = {
      signalk: { self: { a: 10 } },
      pathMeta: {
        self: {
          a: {
            displayUnits: {
              category: "speed",
              targetUnit: "kn",
              formula: "value * 1.94384",
              symbol: "kn",
            },
          },
        },
      },
    };
    assert.equal(renderBinding(parseBinding("path=a,round=1"), context), "19.4kn");
  });

  await t.test("format=raw opts out of automatic unit conversion", () => {
    const context: TemplateContext = {
      signalk: { self: { a: 10 } },
      pathMeta: {
        self: {
          a: {
            displayUnits: {
              category: "speed",
              targetUnit: "kn",
              formula: "value * 1.94384",
              symbol: "kn",
            },
          },
        },
      },
    };
    assert.equal(renderBinding(parseBinding("path=a,format=raw,round=1"), context), "10.0");
  });

  await t.test("null/undefined render as an empty string", () => {
    const context: TemplateContext = { signalk: { self: { a: null } } };
    assert.equal(renderBinding(parseBinding("path=a"), context), "");
  });

  await t.test("a missing value with an explicit default= uses that default instead of empty string", () => {
    const context: TemplateContext = { signalk: { self: {} } };
    assert.equal(renderBinding(parseBinding("path=a,default=n/a"), context), "n/a");
  });

  await t.test("default= with an empty value means the default is an empty string, not null/undefined", () => {
    const context: TemplateContext = { signalk: { self: {} } };
    assert.equal(renderBinding(parseBinding("path=a,default="), context), "");
  });

  await t.test("default= is ignored when the value is actually present", () => {
    const context: TemplateContext = { signalk: { self: { a: "real value" } } };
    assert.equal(renderBinding(parseBinding("path=a,default=n/a"), context), "real value");
  });

  await t.test("an unformatted object renders as JSON", () => {
    const context: TemplateContext = { signalk: { self: { a: { x: 1 } } } };
    assert.equal(renderBinding(parseBinding("path=a"), context), '{"x":1}');
  });

  await t.test("falls through to String() for anything else", () => {
    const context: TemplateContext = { signalk: { self: { a: true } } };
    assert.equal(renderBinding(parseBinding("path=a"), context), "true");
  });

  await t.test("source=einklabel,format=local_datetime_short renders the repaint timestamp", () => {
    const context: TemplateContext = {
      signalk: { self: { environment: { time: { timezoneRegion: "Europe/London" } } } },
      meta: { repainted: "2026-06-21T17:05:00Z" },
    };
    assert.equal(renderBinding(parseBinding("source=einklabel,path=repainted,format=local_datetime_short"), context), "21 Jun 26 18:05");
  });
});

test("buildLabelContext", async (t) => {
  await t.test("annotates each colour with its hex code", () => {
    const label = buildLabelContext({
      manufacturer: "zhsunyco",
      label: '3.7"',
      width: 416,
      height: 240,
      colours: ["black", "white", "red"],
    });
    assert.deepEqual(label.colours, ["black (#000000)", "white (#FFFFFF)", "red (#FF0000)"]);
  });

  await t.test("only offers the three font-family keywords SvgRenderer is guaranteed to render", () => {
    const label = buildLabelContext({ manufacturer: "x", label: "y", width: 1, height: 1, colours: [] });
    assert.deepEqual(label.fonts, ["serif", "sans-serif", "monospace"]);
  });

  await t.test("defaults description to empty rather than undefined", () => {
    const label = buildLabelContext({ manufacturer: "x", label: "y", width: 1, height: 1, colours: [] });
    assert.equal(label.description, "");
  });

  await t.test("formats and rounds position to a plain lat/lon string when given", () => {
    const label = buildLabelContext({
      manufacturer: "x",
      label: "y",
      width: 1,
      height: 1,
      colours: [],
      position: { latitude: 51.5001, longitude: -0.1001 },
    });
    assert.equal(label.position, "51.50°N 0.10°W");
  });

  await t.test("leaves position undefined when not given", () => {
    const label = buildLabelContext({ manufacturer: "x", label: "y", width: 1, height: 1, colours: [] });
    assert.equal(label.position, undefined);
  });
});

test("findTextBindings", async (t) => {
  await t.test("parses every {...} placeholder across fragments, deduplicated", () => {
    const bindings = findTextBindings("for a {design.length}m vessel", "width={source=label,path=width}, again {design.length}");
    assert.deepEqual(bindings, [
      { source: "signalk", context: "self", path: "design.length" },
      {
        source: "label",
        context: "self",
        resource: undefined,
        provider: undefined,
        path: "width",
        format: undefined,
        category: undefined,
        round: undefined,
        assets: undefined,
        default: undefined,
      },
    ]);
  });

  await t.test("silently skips a placeholder that isn't valid binding grammar", () => {
    // No crash - substituteTextBindings hits the identical parse error per-field and shows "???".
    assert.deepEqual(findTextBindings("bad: {source=taheight}"), []);
  });

  await t.test("returns nothing for text with no placeholders", () => {
    assert.deepEqual(findTextBindings("no placeholders here"), []);
  });
});

test("substituteTextBindings", async (t) => {
  const context: TemplateContext = {
    signalk: { self: { design: { length: 11, aisShipType: { name: "Sailing" } } } },
    label: buildLabelContext({ manufacturer: "zhsunyco", label: '3.7"', width: 416, height: 240, colours: ["black", "white"] }),
    pathMeta: {},
    categories: {},
  };

  await t.test("resolves a bare SignalK self path (shorthand for source=signalk,context=self)", () => {
    assert.equal(substituteTextBindings("{design.aisShipType.name}", context), "Sailing");
  });

  await t.test("resolves a full source=label binding", () => {
    assert.equal(substituteTextBindings("{source=label,path=manufacturer}", context), "zhsunyco");
  });

  await t.test("applies format=csv to join an array value", () => {
    assert.equal(substituteTextBindings("{source=label,path=colours,format=csv}", context), "black (#000000), white (#FFFFFF)");
  });

  await t.test('substitutes "???" for a SignalK path with no data', () => {
    assert.equal(substituteTextBindings("{design.beam}", context), "???");
  });

  await t.test('substitutes "???" for invalid binding grammar, not a crash', () => {
    assert.equal(substituteTextBindings("{source=taheight}", context), "???");
  });

  await t.test('uses an explicit default= instead of "???" for a missing value', () => {
    assert.equal(substituteTextBindings("{path=design.beam,default=n/a}", context), "n/a");
  });

  await t.test('an explicit empty default= is a deliberate blank, not "???"', () => {
    assert.equal(substituteTextBindings("[{source=label,path=nonexistent,default=}]", context), "[]");
  });

  await t.test('leaves a legitimately empty resolved value as empty, not "???"', () => {
    // label.description defaults to "" (see buildLabelContext) - a deliberate blank, not a lookup miss.
    assert.equal(substituteTextBindings("[{source=label,path=description}]", context), "[]");
  });

  await t.test("substitutes every occurrence, including repeats", () => {
    assert.equal(substituteTextBindings("{design.aisShipType.name} and {design.aisShipType.name}", context), "Sailing and Sailing");
  });
});
