#!/usr/bin/env node
"use strict";

/**
 * Collects src/**\/*.test.ts itself and passes explicit file paths to `node --test`, rather than a
 * glob string - Node's own CLI glob expansion for --test only exists on newer Node releases, and this
 * plugin's CI matrix includes Node 20 (armv7/Cerbo GX), which takes a quoted glob literally and fails
 * with "Could not find '.../*.test.ts'". A manual directory walk works identically on every Node
 * version and OS in the matrix, including Windows, where npm runs scripts via cmd.exe and shell globs
 * like `**` or `$(find ...)` aren't available anyway.
 */

const { readdirSync, mkdirSync } = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");

function findTestFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTestFiles(full);
    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const coverage = process.argv.includes("--coverage");
const testFiles = findTestFiles(path.join(rootDir, "src"));

const args = ["--require", "ts-node/register"];
if (coverage) {
  mkdirSync(path.join(rootDir, "coverage"), { recursive: true });
  args.push(
    "--experimental-test-coverage",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=coverage/lcov.info",
  );
}
args.push("--test", ...testFiles);

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: rootDir });
process.exit(result.status ?? 1);
