export type LogLevel = "info" | "debug";

const LEVELS: LogLevel[] = ["info", "debug"];

let currentLevel: LogLevel = "info";

/** Set once from the global `--log-level` option (see index.ts's `preAction` hook) - applies to every command. */
export function setLogLevel(level: string): void {
  if (!LEVELS.includes(level as LogLevel)) {
    throw new Error(`unknown --log-level "${level}" - expected one of ${LEVELS.join(", ")}`);
  }
  currentLevel = level as LogLevel;
}

/** Internal tracing (e.g. which URL is being fetched) - silent unless --log-level debug, so default output stays uncluttered. */
export function logDebug(message: string): void {
  if (currentLevel === "debug") console.error(`[debug] ${message}`);
}
