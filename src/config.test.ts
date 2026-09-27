import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { ServerAPI } from "@signalk/server-api";
import { Colour, DiscoveredDevice } from "./devices/types";
import { registerTemplateProvider, TemplateProvider } from "./render/templateProviders";
import {
  configSchema,
  configUiSchema,
  defaultConfig,
  healStoredConfig,
  migrateConfig,
  readCurrentConfig,
  parseDevice,
  PluginConfig,
  resolveTemplatePath,
  resolveTemplatesDir,
} from "./config";

/** The device picker's options as `[value, label]` pairs - it's `oneOf` with `const`/`title` (see `withEnum`). */
function deviceChoices(deviceSchema: { oneOf: { const: string; title: string }[] }): [string, string][] {
  return deviceSchema.oneOf.map((option) => [option.const, option.title]);
}

function fakeApp(options: Partial<PluginConfig> = {}): ServerAPI {
  return { readPluginOptions: () => options } as unknown as ServerAPI;
}

function fakeAppWithSave(raw: unknown): { app: ServerAPI; saved: unknown[] } {
  const saved: unknown[] = [];
  const app = {
    readPluginOptions: () => raw,
    savePluginOptions: (configuration: unknown, cb: (err?: Error) => void) => {
      saved.push(configuration);
      cb();
    },
    debug: () => {},
  } as unknown as ServerAPI;
  return { app, saved };
}

test("resolveTemplatesDir", async (t) => {
  await t.test("defaults to ~/.signalk/esl/templates when empty/undefined", () => {
    const expected = join(homedir(), ".signalk", "einklabel", "templates");
    assert.equal(resolveTemplatesDir(undefined), expected);
    assert.equal(resolveTemplatesDir(""), expected);
    assert.equal(resolveTemplatesDir("   "), expected);
  });

  await t.test("resolves a relative path against ~/.signalk", () => {
    assert.equal(resolveTemplatesDir("my-templates"), join(homedir(), ".signalk", "my-templates"));
  });

  await t.test("uses an absolute path as-is", () => {
    assert.equal(resolveTemplatesDir("/srv/esl/templates"), "/srv/esl/templates");
  });
});

test("parseDevice", async (t) => {
  await t.test("parses vendor:pid@address", () => {
    assert.deepEqual(parseDevice("zhsunyco:14@66:66:17:50:0C:74"), {
      vendor: "zhsunyco",
      pid: 14,
      hwVersion: undefined,
      address: "66:66:17:50:0C:74",
    });
  });

  await t.test("parses an optional hwVersion", () => {
    assert.deepEqual(parseDevice("zhsunyco:14:v2@AA:BB:CC:DD:EE:FF"), {
      vendor: "zhsunyco",
      pid: 14,
      hwVersion: "v2",
      address: "AA:BB:CC:DD:EE:FF",
    });
  });

  await t.test("returns undefined for a malformed token", () => {
    assert.equal(parseDevice("not-a-valid-device-token"), undefined);
    assert.equal(parseDevice("zhsunyco:notanumber@AA:BB:CC:DD:EE:FF"), undefined);
  });
});

test("defaultConfig has sane defaults", () => {
  const defaults = defaultConfig();
  assert.equal(defaults.templatesDir, "");
  assert.equal(defaults.scanOnStart, false);
  assert.equal(defaults.scanDurationSeconds, 20);
  assert.equal(defaults.paintConnectTimeoutSeconds, 30);
  assert.equal(defaults.paintRetries, 3);
  assert.deepEqual(defaults.devices, []);
});

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "einklabel-templates-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveTemplatePath", async (t) => {
  await t.test("falls back to the bundled templates dir when there is no local override", () => {
    withTempDir((dir) => {
      assert.match(resolveTemplatePath(dir, "tide.svg"), /[\\/]templates[\\/]tide\.svg$/);
    });
  });

  await t.test("prefers a local template over the bundled one of the same name", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "tide.svg"), "<svg/>");
      assert.equal(resolveTemplatePath(dir, "tide.svg"), join(dir, "tide.svg"));
    });
  });
});

test("resolveTemplatePath - template-family directories", async (t) => {
  function withVariants(files: string[], fn: (dir: string) => void): void {
    withTempDir((templatesDir) => {
      const familyDir = join(templatesDir, "family");
      mkdirSync(familyDir);
      for (const file of files) writeFileSync(join(familyDir, file), "<svg/>");
      fn(templatesDir);
    });
  }

  function target(width: number, height: number, colours: Colour[]): { width: number; height: number; colours: Colour[] } {
    return { width, height, colours };
  }

  await t.test("without a target, a directory name resolves like any other path (no picking)", () => {
    withVariants(["416x240-BWRY.svg"], (dir) => {
      assert.equal(resolveTemplatePath(dir, "family"), join(dir, "family"));
    });
  });

  await t.test("picks an exact width/height/colour-set match", () => {
    withVariants(["416x240-BWRY.svg", "416x240-BWR.svg", "250x128-BWRY.svg"], (dir) => {
      assert.equal(resolveTemplatePath(dir, "family", target(416, 240, ["black", "white", "red"])), join(dir, "family", "416x240-BWR.svg"));
    });
  });

  await t.test("falls back to a width/height match when no colour-set matches exactly", () => {
    withVariants(["416x240-BWRY.svg", "250x128-BWRY.svg"], (dir) => {
      assert.equal(resolveTemplatePath(dir, "family", target(416, 240, ["black", "white"])), join(dir, "family", "416x240-BWRY.svg"));
    });
  });

  await t.test("falls back to nearest width, tie-broken by closest height/width ratio", () => {
    withVariants(["400x300-BWRY.svg", "300x100-BWRY.svg"], (dir) => {
      // Target width 350 is equidistant (50) from both 400 and 300, so it's a genuine width tie.
      // Ratios: 400x300 is 0.75, 300x100 is 0.333, target (350x175) is 0.5 - |0.75-0.5|=0.25 vs
      // |0.333-0.5|=0.167, so 300x100's ratio is closer and wins the tie-break.
      assert.equal(
        resolveTemplatePath(dir, "family", target(350, 175, ["black", "white", "red", "yellow"])),
        join(dir, "family", "300x100-BWRY.svg"),
      );
    });
  });

  await t.test("throws when a target is given but the directory has no parseable variant files", () => {
    withVariants(["not-a-variant.svg"], (dir) => {
      assert.throws(() => resolveTemplatePath(dir, "family", target(416, 240, ["black"])), /no valid.*files/);
    });
  });
});

test("configSchema", async (t) => {
  await t.test("lists local and bundled template names, with a local one shadowing a same-named bundled one", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "custom.svg"), "<svg/>");
      writeFileSync(join(dir, "tide.svg"), "<svg/>");
      const schema = configSchema(fakeApp({ templatesDir: dir }), []) as any;
      // "tides"/"watch" are bundled template-family directories (templates/tides/*x*-*.svg etc) -
      // always offered alongside flat files, see the "template-family directories" tests below.
      // The bundled ".error" fallback family is dot-prefixed, so it's excluded here, same as ".assets".
      assert.deepEqual(schema.properties.devices.items.properties.templateName.enum, ["custom.svg", "tide.svg", "tides", "watch"]);
    });
  });

  await t.test("merges in every registered TemplateProvider's own entries, after files/families", () => {
    const provider: TemplateProvider = {
      suffix: "(Test)",
      listTemplates: () => ["fake-entry (Test)"],
      describeBindings: () => [],
      render: async () => {
        throw new Error("not used in this test");
      },
    };
    registerTemplateProvider(provider);
    const schema = configSchema(fakeApp(), []) as any;
    assert.ok(schema.properties.devices.items.properties.templateName.enum.includes("fake-entry (Test)"));
  });

  await t.test("builds the device choices from discovered devices, skipping ones with no confirmed pid", () => {
    const discovered: DiscoveredDevice[] = [
      {
        address: "AA:AA:AA:AA:AA:AA",
        vendor: "zhsunyco",
        pid: 14,
        metadata: {
          pid: 14,
          label: "2.9in BWR",
          width: 296,
          height: 128,
          voffset: 0,
          colours: ["black", "white", "red"],
        },
      },
      { address: "BB:BB:BB:BB:BB:BB", vendor: "zhsunyco", pid: 0x99, hwVersion: "v2" },
      { address: "CC:CC:CC:CC:CC:CC", vendor: "zhsunyco" },
    ];
    const schema = configSchema(fakeApp(), discovered) as any;
    const deviceSchema = schema.properties.devices.items.properties.device;
    assert.equal(deviceSchema.enumNames, undefined);
    assert.deepEqual(deviceChoices(deviceSchema), [
      ["ALL", "All discovered devices"],
      ["zhsunyco:14@AA:AA:AA:AA:AA:AA", "zhsunyco 2.9in BWR (AA:AA:AA:AA:AA:AA)"],
      ["zhsunyco:153:v2@BB:BB:BB:BB:BB:BB", "zhsunyco unrecognised PID 0x0099 (BB:BB:BB:BB:BB:BB)"],
    ]);
  });

  await t.test("keeps a saved device from the current config even if not seen in the last scan", () => {
    const app = fakeApp({
      devices: [
        {
          friendlyName: "Galley label",
          device: "zhsunyco:14@AA:AA:AA:AA:AA:AA",
          templateName: "tide.svg",
          repaintTrigger: "interval",
        },
      ],
    });
    const deviceSchema = (configSchema(app, []) as any).properties.devices.items.properties.device;
    assert.deepEqual(deviceChoices(deviceSchema), [
      ["ALL", "All discovered devices"],
      ["zhsunyco:14@AA:AA:AA:AA:AA:AA", "zhsunyco:14@AA:AA:AA:AA:AA:AA (not seen in last scan)"],
    ]);
  });

  await t.test("always offers ALL_DEVICES even with no scanned or configured devices", () => {
    const deviceSchema = (configSchema(fakeApp(), []) as any).properties.devices.items.properties.device;
    assert.deepEqual(deviceChoices(deviceSchema), [["ALL", "All discovered devices"]]);
  });

  await t.test("carries defaultConfig() values through as JSON Schema defaults", () => {
    const schema = configSchema(fakeApp(), []) as any;
    assert.equal(schema.properties.scanOnStart.default, false);
    assert.equal(schema.properties.paintRetries.default, 3);
  });

  await t.test("offers radio choices as explanatory labels while storing the same bare values", () => {
    const device = (configSchema(fakeApp(), []) as any).properties.devices.items.properties;
    const advanced = device.advanced.properties;
    for (const [schema, values] of [
      [device.repaintTrigger, ["subscription", "interval"]],
      [advanced.reframe, ["crop", "scale", "fixed"]],
      [advanced.mirror, ["none", "horizontal", "vertical", "both"]],
      [advanced.compressionFormat, ["auto", "chunked"]],
    ] as const) {
      assert.deepEqual(
        schema.oneOf.map((option: { const: string }) => option.const),
        values,
      );
      for (const option of schema.oneOf) {
        // Leading en space keeps the label clear of its radio button in the admin UI.
        assert.match(option.title, /^ \S/);
        assert.notEqual(option.title.trim(), option.const);
      }
    }
  });

  await t.test("groups the rarely-needed device settings under an Advanced settings object", () => {
    const device = (configSchema(fakeApp(), []) as any).properties.devices.items.properties;
    assert.equal(device.advanced.type, "object");
    assert.equal(device.advanced.title, "Advanced settings");
    assert.deepEqual(Object.keys(device.advanced.properties), [
      "reframe",
      "compress",
      "mirror",
      "compressionFormat",
      "forceRepaint",
      "aesKey",
      "paintConnectTimeoutSeconds",
      "paintRetries",
    ]);
    for (const key of Object.keys(device.advanced.properties)) assert.equal(device[key], undefined, key);
  });

  await t.test("only shows the trigger path or the interval fields, whichever the repaint trigger needs", () => {
    const items = (configSchema(fakeApp(), []) as any).properties.devices.items;
    for (const field of ["triggerPath", "intervalHours", "intervalMinute"]) assert.equal(items.properties[field], undefined, field);
    const branches = Object.fromEntries(
      items.dependencies.repaintTrigger.oneOf.map((branch: any) => [
        branch.properties.repaintTrigger.const,
        Object.keys(branch.properties),
      ]),
    );
    assert.deepEqual(branches, {
      subscription: ["repaintTrigger", "triggerPath"],
      interval: ["repaintTrigger", "intervalHours", "intervalMinute"],
    });
  });

  await t.test("accepts only a blank or 32-hex-character AES key", () => {
    const pattern = new RegExp((configSchema(fakeApp(), []) as any).properties.devices.items.properties.advanced.properties.aesKey.pattern);
    assert.ok(pattern.test(""));
    assert.ok(pattern.test("00112233445566778899AABBCCDDEEFF"));
    assert.ok(!pattern.test("0011"));
    assert.ok(!pattern.test("00112233445566778899aabbccddeegg"));
  });

  await t.test("per-device retry/timeout fields have no default, so blank falls back to the plugin-wide value", () => {
    const device = (configSchema(fakeApp({ paintRetries: 5, paintConnectTimeoutSeconds: 45 }), []) as any).properties.devices.items
      .properties.advanced.properties;
    assert.equal(device.paintRetries.default, undefined);
    assert.equal(device.paintConnectTimeoutSeconds.default, undefined);
    assert.match(device.paintRetries.description, /currently 5\b/);
    assert.match(device.paintConnectTimeoutSeconds.description, /currently 45s/);
  });
});

test("healStoredConfig", async (t) => {
  await t.test("does nothing when the on-disk file is neither nested nor has ungrouped advanced settings", () => {
    const { app, saved } = fakeAppWithSave({ configuration: { templatesDir: "", devices: [] }, enabled: true });
    healStoredConfig(app);
    assert.deepEqual(saved, []);
  });

  await t.test("flattens a legacy multiply-nested file down to just its recognised, innermost fields", () => {
    // Mirrors the real corruption in support/signalk-einklabel-plugin.json: a live top-level
    // `configuration` plus a dead `configuration.configuration...` blob riding along inside it,
    // which nothing else ever strips since the admin UI round-trips unknown keys verbatim.
    const raw = {
      configuration: {
        templatesDir: "",
        devices: [{ friendlyName: "Tide Clock", device: "ALL", templateName: "tides", repaintTrigger: "interval" }],
        configuration: {
          configuration: {
            templatesDir: "stale",
            devices: [
              { friendlyName: "old", device: "zhsunyco:14@AA:AA:AA:AA:AA:AA", templateName: "tide.svg", repaintTrigger: "interval" },
            ],
            enabled: true,
          },
          enabled: true,
        },
      },
      enabled: true,
    };
    const { app, saved } = fakeAppWithSave(raw);
    healStoredConfig(app);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
      templatesDir: "stale",
      devices: [{ friendlyName: "old", device: "zhsunyco:14@AA:AA:AA:AA:AA:AA", templateName: "tide.svg", repaintTrigger: "interval" }],
    });
  });

  await t.test("moves advanced device settings saved at the top level of a device into its advanced group", () => {
    const device = { friendlyName: "Tide Clock", device: "ALL", templateName: "tides", repaintTrigger: "interval" };
    const { app, saved } = fakeAppWithSave({
      configuration: { devices: [{ ...device, reframe: "scale", aesKey: "00", forceRepaint: true, mirror: "both", paintRetries: 5 }] },
      enabled: true,
    });
    healStoredConfig(app);
    assert.deepEqual(saved, [
      { devices: [{ ...device, advanced: { reframe: "scale", aesKey: "00", forceRepaint: true, mirror: "both", paintRetries: 5 } }] },
    ]);
  });
});

test("migrateConfig", async (t) => {
  const base = { friendlyName: "Tide Clock", device: "ALL", templateName: "tides", repaintTrigger: "interval" as const };

  await t.test("leaves an already-grouped config untouched", () => {
    const config = { devices: [{ ...base, advanced: { mirror: "both" as const } }] };
    assert.deepEqual(migrateConfig(config), { config, migrated: false });
  });

  await t.test("prefers a value already under advanced over a legacy top-level one", () => {
    const legacy = { ...base, compress: true, advanced: { compress: false } };
    const { config, migrated } = migrateConfig({ devices: [legacy as any] });
    assert.equal(migrated, true);
    assert.deepEqual(config.devices, [{ ...base, advanced: { compress: false } }]);
  });

  await t.test("readCurrentConfig returns the grouped shape for a legacy file", () => {
    const current = readCurrentConfig(fakeApp({ devices: [{ ...base, forceRepaint: true } as any] }));
    assert.deepEqual(current.devices, [{ ...base, advanced: { forceRepaint: true } }]);
  });
});

test("configUiSchema", async (t) => {
  const ui = configUiSchema() as any;
  const items = ui.devices.items;
  const schemaItems = (configSchema(fakeApp(), []) as any).properties.devices.items;

  await t.test("renders the choice fields as radio groups and description as a textarea", () => {
    assert.equal(items.description["ui:widget"], "textarea");
    assert.equal(items.repaintTrigger["ui:widget"], "radio");
    for (const field of ["reframe", "mirror", "compressionFormat"]) assert.equal(items.advanced[field]["ui:widget"], "radio", field);
  });

  await t.test("orders every device field, including the trigger-dependent ones, with Advanced settings last", () => {
    const dependent = schemaItems.dependencies.repaintTrigger.oneOf.flatMap((branch: any) => Object.keys(branch.properties));
    const order: string[] = items["ui:order"];
    for (const field of [...Object.keys(schemaItems.properties), ...dependent]) {
      assert.ok(order.includes(field) || order.includes("*"), field);
    }
    assert.equal(order[order.length - 1], "advanced");
    assert.ok(order.indexOf("triggerPath") > order.indexOf("repaintTrigger"));
  });

  await t.test("enables Markdown on every field whose description links to the docs", () => {
    const withLinks = (properties: Record<string, any>, uiFields: Record<string, any>) =>
      Object.entries(properties)
        .filter(([, field]) => typeof field.description === "string" && field.description.includes("](https://"))
        .map(([name]) => [name, uiFields[name]?.["ui:enableMarkdownInDescription"]]);
    const linked = [...withLinks(schemaItems.properties, items), ...withLinks(schemaItems.properties.advanced.properties, items.advanced)];
    assert.ok(linked.length >= 5);
    for (const [name, markdown] of linked) assert.equal(markdown, true, name);
  });
});
