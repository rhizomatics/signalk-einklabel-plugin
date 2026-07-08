import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { ServerAPI } from "@signalk/server-api";
import { Colour, DiscoveredDevice } from "./devices/types";
import {
  configSchema,
  configUiSchema,
  defaultConfig,
  healNestedConfig,
  parseDevice,
  PluginConfig,
  resolveTemplatePath,
  resolveTemplatesDir,
} from "./config";

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
      // "tides" is the bundled template-family directory (templates/tides/*x*-*.svg) - always offered
      // alongside flat files, see the "template-family directories" tests below.
      assert.deepEqual(schema.properties.devices.items.properties.templateName.enum, ["custom.svg", "tide.svg", "tides"]);
    });
  });

  await t.test("builds the device enum/enumNames from discovered devices, skipping ones with no confirmed pid", () => {
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
    assert.deepEqual(deviceSchema.enum, ["ALL", "zhsunyco:14@AA:AA:AA:AA:AA:AA", "zhsunyco:153:v2@BB:BB:BB:BB:BB:BB"]);
    assert.deepEqual(deviceSchema.enumNames, [
      "All discovered devices",
      "zhsunyco 2.9in BWR (AA:AA:AA:AA:AA:AA)",
      "zhsunyco unrecognised PID 0x0099 (BB:BB:BB:BB:BB:BB)",
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
    assert.deepEqual(deviceSchema.enum, ["ALL", "zhsunyco:14@AA:AA:AA:AA:AA:AA"]);
    assert.deepEqual(deviceSchema.enumNames, ["All discovered devices", "zhsunyco:14@AA:AA:AA:AA:AA:AA (not seen in last scan)"]);
  });

  await t.test("always offers ALL_DEVICES even with no scanned or configured devices", () => {
    const deviceSchema = (configSchema(fakeApp(), []) as any).properties.devices.items.properties.device;
    assert.deepEqual(deviceSchema.enum, ["ALL"]);
    assert.deepEqual(deviceSchema.enumNames, ["All discovered devices"]);
  });

  await t.test("carries defaultConfig() values through as JSON Schema defaults", () => {
    const schema = configSchema(fakeApp(), []) as any;
    assert.equal(schema.properties.scanOnStart.default, false);
    assert.equal(schema.properties.paintRetries.default, 3);
  });
});

test("healNestedConfig", async (t) => {
  await t.test("does nothing when the on-disk file isn't nested", () => {
    const { app, saved } = fakeAppWithSave({ configuration: { templatesDir: "", devices: [] }, enabled: true });
    healNestedConfig(app);
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
    healNestedConfig(app);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
      templatesDir: "stale",
      devices: [{ friendlyName: "old", device: "zhsunyco:14@AA:AA:AA:AA:AA:AA", templateName: "tide.svg", repaintTrigger: "interval" }],
    });
  });
});

test("configUiSchema renders repaintTrigger as a radio group", () => {
  assert.deepEqual(configUiSchema(), {
    devices: { items: { repaintTrigger: { "ui:widget": "radio" } } },
  });
});
