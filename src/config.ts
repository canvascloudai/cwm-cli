import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CwmConfig {
  baseUrl: string;
  apiKey: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".cwm");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): Partial<CwmConfig> {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as Partial<CwmConfig>;
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<CwmConfig>): void {
  const existing = loadConfig();
  const merged = { ...existing, ...updates };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

export function resolveConfig(
  opts: { baseUrl?: string; apiKey?: string } = {},
): CwmConfig {
  const stored = loadConfig();
  const baseUrl =
    opts.baseUrl ??
    stored.baseUrl ??
    process.env["CWM_BASE_URL"] ??
    "http://localhost:5000";
  const apiKey =
    opts.apiKey ?? stored.apiKey ?? process.env["CWM_API_KEY"] ?? "";
  return { baseUrl, apiKey };
}
