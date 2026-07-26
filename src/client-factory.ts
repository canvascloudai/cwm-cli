import { CwmClient } from "../../sdk/typescript/src/client.js";
import { resolveConfig } from "./config.js";

export function makeClient(opts: { baseUrl?: string; apiKey?: string } = {}): CwmClient {
  const cfg = resolveConfig(opts);
  return new CwmClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
}
