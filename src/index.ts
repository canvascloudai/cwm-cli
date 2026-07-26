import { Command } from "commander";
import fs from "node:fs";
import { saveConfig, loadConfig } from "./config.js";
import { makeClient } from "./client-factory.js";
import { printJson, printKv, printTable, type OutputFormat } from "./output.js";
import { CwmError } from "../../sdk/typescript/src/client.js";
import type { RlAction } from "../../sdk/typescript/src/types.js";

function globalOpts(cmd: Command): { baseUrl?: string; apiKey?: string; output: OutputFormat } {
  const opts = cmd.optsWithGlobals();
  return {
    baseUrl: opts["baseUrl"] as string | undefined,
    apiKey: opts["apiKey"] as string | undefined,
    output: (opts["output"] as OutputFormat) ?? "text",
  };
}

function die(err: unknown): never {
  if (err instanceof CwmError) {
    console.error(`Error ${err.statusCode}: ${err.serverMessage}`);
  } else {
    console.error(String(err));
  }
  process.exit(1);
}

function readFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    console.error(`Failed to read or parse file: ${filePath}`);
    process.exit(1);
  }
}

const CLI_ACTION_ALIASES: Record<string, string> = {
  scale_up: "scale_out",
  scale_down: "scale_in",
  no_op: "adjust_threshold",
};

const VALID_CLI_ACTIONS = [
  "scale_up", "scale_down", "no_op",
  "scale_out", "scale_in", "adjust_threshold", "add_resource", "remove_resource",
];

function resolveRlAction(raw: string): RlAction {
  const type = (CLI_ACTION_ALIASES[raw] ?? raw) as RlAction["type"];
  return { type, parameters: {} };
}

const program = new Command();

program
  .name("cwm")
  .description("Cloud World Model CLI — interact with the CWM simulation API")
  .version("1.0.0")
  .option("--base-url <url>", "CWM server URL (overrides config)")
  .option("--api-key <key>", "API key (overrides config)")
  .option("--output <format>", "Output format: text | json", "text");

// ------------------------------------------------------------------ //
// config                                                               //
// ------------------------------------------------------------------ //

const config = new Command("config").description("Manage CLI configuration");
program.addCommand(config);

config
  .command("set")
  .description("Save connection settings to ~/.cwm/config.json")
  .option("--base-url <url>", "CWM server base URL")
  .option("--api-key <key>", "API key")
  .action((opts) => {
    const updates: Record<string, string> = {};
    if (opts["baseUrl"]) updates["baseUrl"] = opts["baseUrl"] as string;
    if (opts["apiKey"]) updates["apiKey"] = opts["apiKey"] as string;
    saveConfig(updates);
    console.log("Config saved to ~/.cwm/config.json");
  });

config
  .command("show")
  .description("Print current configuration")
  .action((opts, cmd) => {
    const { output } = globalOpts(cmd);
    const cfg = loadConfig();
    const masked: Record<string, unknown> = { ...cfg };
    if (masked["apiKey"]) masked["apiKey"] = (masked["apiKey"] as string).substring(0, 8) + "****";
    if (Object.keys(masked).length === 0) {
      console.log("No config file found. Run: cwm config set --base-url <url> --api-key <key>");
    } else if (output === "json") {
      printJson(masked);
    } else {
      printKv(masked);
    }
  });

// ------------------------------------------------------------------ //
// simulate                                                             //
// ------------------------------------------------------------------ //

const simulate = new Command("simulate").description("Simulation management");
program.addCommand(simulate);

simulate
  .command("create")
  .description("Create a simulation from a JSON spec file")
  .requiredOption("--file <path>", "Path to simulation spec JSON")
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const spec = readFile(opts["file"] as string) as Parameters<ReturnType<typeof makeClient>["createSimulation"]>[0];
    try {
      const sim = await makeClient({ baseUrl, apiKey }).createSimulation(spec);
      if (output === "json") {
        printJson(sim);
      } else {
        console.log(`Simulation created: ${sim.id}`);
        console.log(`  Name:      ${sim.name}`);
        console.log(`  Resources: ${sim.resources.length}`);
        console.log(`  Created:   ${sim.createdAt}`);
      }
    } catch (err) { die(err); }
  });

simulate
  .command("get <id>")
  .description("Fetch the current state of a simulation")
  .action(async (id: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const sim = await makeClient({ baseUrl, apiKey }).getSimulation(id);
      if (output === "json") {
        printJson(sim);
      } else {
        console.log(`ID:        ${sim.id}`);
        console.log(`Name:      ${sim.name}`);
        console.log(`Running:   ${sim.isRunning}`);
        console.log(`Traffic:   ${sim.traffic} RPS`);
        console.log(`Cost/hr:   $${Number(sim.lastCostPerHour).toFixed(4)}`);
        console.log(`Resources: ${sim.resources.length}`);
      }
    } catch (err) { die(err); }
  });

simulate
  .command("list")
  .description("List all simulations")
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const sims = await makeClient({ baseUrl, apiKey }).listSimulations();
      if (output === "json") {
        printJson(sims);
      } else {
        printTable(
          sims.map((s) => ({
            id: s.id,
            name: s.name,
            running: String(s.isRunning),
            resources: String(s.resources.length),
          })),
          ["id", "name", "running", "resources"],
        );
      }
    } catch (err) { die(err); }
  });

simulate
  .command("step <id>")
  .description("Advance the simulation one tick and print metrics")
  .option("--traffic <rps>", "RPS to inject", parseFloat)
  .action(async (id: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const result = await makeClient({ baseUrl, apiKey }).simulateStep(id, {
        traffic: opts["traffic"] as number | undefined,
      });
      if (output === "json") {
        printJson(result);
      } else {
        const m = result.metrics;
        console.log(`Step complete — simulation ${id}`);
        console.log(`  CPU:         ${Number(m.cpuUsage).toFixed(1)}%`);
        console.log(`  Latency P95: ${Number(m.latencyP95).toFixed(0)}ms`);
        console.log(`  Throughput:  ${Number(m.throughput).toFixed(0)} RPS`);
        console.log(`  Error rate:  ${(Number(m.errorRate) * 100).toFixed(2)}%`);
        console.log(`  Cost/hr:     $${Number(m.costPerHour).toFixed(4)}`);
      }
    } catch (err) { die(err); }
  });

// ------------------------------------------------------------------ //
// rl                                                                   //
// ------------------------------------------------------------------ //

const rl = new Command("rl").description("RL environment management");
program.addCommand(rl);

rl.command("create <simulation-id>")
  .description("Create a Gym-compatible RL environment for a simulation")
  .option("--max-steps <n>", "Episode length (default: 300)", parseInt)
  .action(async (simulationId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const result = await makeClient({ baseUrl, apiKey }).createRlEnvironment(simulationId, {
        episodeConfig: opts["maxSteps"] ? { maxSteps: opts["maxSteps"] as number } : undefined,
      });
      if (output === "json") {
        printJson(result);
      } else {
        const env = result.environment;
        console.log(`RL environment created: ${env.id}`);
        console.log(`  Simulation: ${env.simulationId}`);
        console.log(`  Max steps:  ${env.episodeConfig.maxSteps ?? 300}`);
      }
    } catch (err) { die(err); }
  });

rl.command("step <env-id> <action>")
  .description("Execute one RL step. Action: scale_up | scale_down | no_op | scale_out | scale_in | adjust_threshold")
  .action(async (envId: string, actionRaw: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    if (!VALID_CLI_ACTIONS.includes(actionRaw)) {
      console.error(`Invalid action "${actionRaw}". Valid actions: ${VALID_CLI_ACTIONS.join(", ")}`);
      process.exit(1);
    }
    const action = resolveRlAction(actionRaw);
    try {
      const result = await makeClient({ baseUrl, apiKey }).rlStep(envId, action);
      if (output === "json") {
        printJson(result);
      } else {
        console.log(`RL step complete`);
        console.log(`  Action:  ${actionRaw} → ${action.type}`);
        console.log(`  Reward:  ${Number(result.reward.total).toFixed(4)}`);
        console.log(`  Done:    ${result.done}`);
      }
    } catch (err) { die(err); }
  });

rl.command("reset <env-id>")
  .description("Reset an RL environment to start a new episode")
  .action(async (envId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const result = await makeClient({ baseUrl, apiKey }).rlReset(envId);
      if (output === "json") {
        printJson(result);
      } else {
        console.log(`RL environment reset.`);
      }
    } catch (err) { die(err); }
  });

// ------------------------------------------------------------------ //
// chaos                                                                //
// ------------------------------------------------------------------ //

const chaos = new Command("chaos").description("Chaos engineering");
program.addCommand(chaos);

chaos
  .command("scenarios")
  .description("List all built-in chaos scenarios")
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const scenarios = await makeClient({ baseUrl, apiKey }).listChaosScenarios();
      if (output === "json") {
        printJson(scenarios);
      } else {
        printTable(
          (scenarios as Array<Record<string, unknown>>).map((s) => ({
            id: String(s["id"] ?? ""),
            name: String(s["name"] ?? ""),
            category: String(s["category"] ?? ""),
            passThreshold: String(s["passThreshold"] ?? ""),
          })),
          ["id", "name", "category", "passThreshold"],
        );
      }
    } catch (err) { die(err); }
  });

chaos
  .command("run <simulation-id>")
  .description("Run a chaos experiment against a simulation")
  .option("--scenario <id>", "Built-in scenario ID (e.g. zone_failure)")
  .option("--duration <ticks>", "Experiment duration in ticks", parseInt)
  .option("--webhook-url <url>", "HTTPS URL for completion callback")
  .option("--wait", "Block until the job finishes and print results inline")
  .option("--poll-interval <ms>", "Polling interval in ms when --wait is used (default: 2000)", parseInt)
  .option("--timeout <ms>", "Maximum wait time in ms when --wait is used (default: 300000)", parseInt)
  .action(async (simulationId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const client = makeClient({ baseUrl, apiKey });
    try {
      const ref = await client.runChaos(simulationId, {
        scenarioId: opts["scenario"] as string | undefined,
        duration: opts["duration"] as number | undefined,
        webhookUrl: opts["webhookUrl"] as string | undefined,
      });
      if (opts["wait"]) {
        if (output !== "json") {
          console.log(`Chaos job started: ${ref.jobId}`);
          console.log(`  Waiting for completion…`);
        }
        const results = await client.waitForChaosJob(ref.jobId, {
          pollIntervalMs: opts["pollInterval"] as number | undefined,
          timeoutMs: opts["timeout"] as number | undefined,
        });
        if (output === "json") {
          printJson(results);
        } else {
          if (results.resilienceScore) {
            const s = results.resilienceScore;
            console.log(`\nResilience Score: ${Number(s.overall).toFixed(1)} / 100  (Grade: ${s.grade})`);
            console.log(`  Recovery:             ${s.breakdown.recovery.toFixed(1)}`);
            console.log(`  Availability:         ${s.breakdown.availability.toFixed(1)}`);
            console.log(`  Data integrity:       ${s.breakdown.dataIntegrity.toFixed(1)}`);
            console.log(`  Graceful degradation: ${s.breakdown.gracefulDegradation.toFixed(1)}`);
          }
          if (results.vulnerabilities && results.vulnerabilities.length > 0) {
            console.log(`\nVulnerabilities (${results.vulnerabilities.length}):`);
            for (const v of results.vulnerabilities as Array<Record<string, unknown>>) {
              console.log(`  [${String(v["severity"]).toUpperCase()}] ${v["title"]}`);
            }
          }
          if (results.recommendations && results.recommendations.length > 0) {
            console.log(`\nRecommendations:`);
            results.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
          }
        }
      } else {
        if (output === "json") {
          printJson(ref);
        } else {
          console.log(`Chaos job started: ${ref.jobId}`);
          console.log(`  Poll with: cwm chaos status ${ref.jobId}`);
          console.log(`  Results:   cwm chaos results ${ref.jobId}`);
        }
      }
    } catch (err) { die(err); }
  });

chaos
  .command("status <job-id>")
  .description("Check the status of a chaos job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const job = await makeClient({ baseUrl, apiKey }).getChaosJob(jobId);
      if (output === "json") {
        printJson(job);
      } else {
        console.log(`Job ${job.id}: ${job.status}`);
        if (job.resilienceScore) {
          console.log(`  Resilience: ${Number(job.resilienceScore.overall).toFixed(1)} (${job.resilienceScore.grade})`);
        }
        if (job.completedAt) console.log(`  Completed: ${job.completedAt}`);
        if (job.error) console.log(`  Error: ${job.error}`);
      }
    } catch (err) { die(err); }
  });

chaos
  .command("results <job-id>")
  .description("Fetch full results of a completed chaos job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const results = await makeClient({ baseUrl, apiKey }).getChaosResults(jobId);
      if (output === "json") {
        printJson(results);
      } else {
        if (results.resilienceScore) {
          const s = results.resilienceScore;
          console.log(`Resilience Score: ${Number(s.overall).toFixed(1)} / 100  (Grade: ${s.grade})`);
          console.log(`  Recovery:             ${s.breakdown.recovery.toFixed(1)}`);
          console.log(`  Availability:         ${s.breakdown.availability.toFixed(1)}`);
          console.log(`  Data integrity:       ${s.breakdown.dataIntegrity.toFixed(1)}`);
          console.log(`  Graceful degradation: ${s.breakdown.gracefulDegradation.toFixed(1)}`);
        }
        if (results.vulnerabilities && results.vulnerabilities.length > 0) {
          console.log(`\nVulnerabilities (${results.vulnerabilities.length}):`);
          for (const v of results.vulnerabilities as Array<Record<string, unknown>>) {
            console.log(`  [${String(v["severity"]).toUpperCase()}] ${v["title"]}`);
          }
        }
        if (results.recommendations && results.recommendations.length > 0) {
          console.log(`\nRecommendations:`);
          results.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
        }
      }
    } catch (err) { die(err); }
  });

// ------------------------------------------------------------------ //
// multicloud                                                           //
// ------------------------------------------------------------------ //

const multicloud = new Command("multicloud").description("Multi-cloud strategy exploration");
program.addCommand(multicloud);

multicloud
  .command("explore")
  .description("Start a multi-cloud strategy exploration job")
  .requiredOption("--file <path>", "Path to workload profile JSON")
  .option("--webhook-url <url>", "HTTPS URL for completion callback")
  .option("--wait", "Block until the job finishes and print results inline")
  .option("--poll-interval <ms>", "Polling interval in ms when --wait is used (default: 2000)", parseInt)
  .option("--timeout <ms>", "Maximum wait time in ms when --wait is used (default: 300000)", parseInt)
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const workload = readFile(opts["file"] as string) as import("../../sdk/typescript/src/types.js").WorkloadProfile;
    const client = makeClient({ baseUrl, apiKey });
    try {
      const ref = await client.exploreMulticloud(workload, {
        webhookUrl: opts["webhookUrl"] as string | undefined,
      });
      if (opts["wait"]) {
        if (output !== "json") {
          console.log(`Multi-cloud job started: ${ref.jobId}`);
          console.log(`  Waiting for completion…`);
        }
        const results = await client.waitForMulticloudJob(ref.jobId, {
          pollIntervalMs: opts["pollInterval"] as number | undefined,
          timeoutMs: opts["timeout"] as number | undefined,
        });
        if (output === "json") {
          printJson(results);
        } else {
          const strategies = results.topStrategies ?? results.allStrategies;
          if (strategies && strategies.length > 0) {
            console.log(`\nTop multi-cloud strategies:`);
            (strategies as Array<Record<string, unknown>>).slice(0, 5).forEach((s, i) => {
              const m = s["metrics"] as Record<string, number> | undefined;
              console.log(`\n  ${i + 1}. ${s["name"]}`);
              if (m?.["totalCostPerHour"] != null) console.log(`     Cost/hr:     $${m["totalCostPerHour"].toFixed(4)}`);
              if (m?.["avgLatencyMs"] != null) console.log(`     Avg latency: ${m["avgLatencyMs"].toFixed(0)}ms`);
              if (m?.["vendorLockInScore"] != null) console.log(`     Lock-in:     ${m["vendorLockInScore"].toFixed(2)}`);
            });
          } else {
            console.log(`Status: ${results.status}`);
            if (results.comparisonReport) console.log(`\n${results.comparisonReport}`);
          }
        }
      } else {
        if (output === "json") {
          printJson(ref);
        } else {
          console.log(`Multi-cloud job started: ${ref.jobId}`);
          console.log(`  Poll with: cwm multicloud status ${ref.jobId}`);
          console.log(`  Results:   cwm multicloud results ${ref.jobId}`);
        }
      }
    } catch (err) { die(err); }
  });

multicloud
  .command("status <job-id>")
  .description("Check the status of a multi-cloud exploration job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const job = await makeClient({ baseUrl, apiKey }).getMulticloudJob(jobId);
      if (output === "json") {
        printJson(job);
      } else {
        console.log(`Job ${job.id}: ${job.status}`);
        if (job.progress != null) console.log(`  Progress:  ${job.progress}%`);
        if (job.completedAt) console.log(`  Completed: ${job.completedAt}`);
        if (job.error) console.log(`  Error: ${job.error}`);
      }
    } catch (err) { die(err); }
  });

multicloud
  .command("results <job-id>")
  .description("Fetch ranked strategies from a completed multi-cloud job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const results = await makeClient({ baseUrl, apiKey }).getMulticloudResults(jobId);
      if (output === "json") {
        printJson(results);
      } else {
        const strategies = results.topStrategies ?? results.allStrategies;
        if (strategies && strategies.length > 0) {
          console.log(`Top multi-cloud strategies:`);
          (strategies as Array<Record<string, unknown>>).slice(0, 5).forEach((s, i) => {
            const m = s["metrics"] as Record<string, number> | undefined;
            console.log(`\n  ${i + 1}. ${s["name"]}`);
            if (m?.["totalCostPerHour"] != null) console.log(`     Cost/hr:     $${m["totalCostPerHour"].toFixed(4)}`);
            if (m?.["avgLatencyMs"] != null) console.log(`     Avg latency: ${m["avgLatencyMs"].toFixed(0)}ms`);
            if (m?.["vendorLockInScore"] != null) console.log(`     Lock-in:     ${m["vendorLockInScore"].toFixed(2)}`);
          });
        } else {
          console.log(`Status: ${results.status}`);
          if (results.comparisonReport) console.log(`\n${results.comparisonReport}`);
        }
      }
    } catch (err) { die(err); }
  });

// ------------------------------------------------------------------ //
// prediction                                                           //
// ------------------------------------------------------------------ //

const prediction = new Command("prediction").description("Predictive scaling assistant");
program.addCommand(prediction);

prediction
  .command("validate")
  .description("Validate infrastructure against a traffic forecast")
  .requiredOption("--simulation-id <id>", "Simulation ID to validate")
  .requiredOption("--file <path>", "Path to traffic forecast JSON")
  .option("--test-steps <n>", "Number of simulation ticks to test (default: 100)", parseInt)
  .option("--webhook-url <url>", "HTTPS URL for completion callback")
  .option("--wait", "Block until the job finishes and print results inline")
  .option("--poll-interval <ms>", "Polling interval in ms when --wait is used (default: 2000)", parseInt)
  .option("--timeout <ms>", "Maximum wait time in ms when --wait is used (default: 300000)", parseInt)
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const forecast = readFile(opts["file"] as string);
    const client = makeClient({ baseUrl, apiKey });
    try {
      const ref = await client.validatePrediction(
        opts["simulationId"] as string,
        forecast,
        {
          testSteps: opts["testSteps"] as number | undefined,
          webhookUrl: opts["webhookUrl"] as string | undefined,
        },
      );
      if (opts["wait"]) {
        if (output !== "json") {
          console.log(`Prediction job started: ${ref.jobId}`);
          console.log(`  Waiting for completion…`);
        }
        const results = await client.waitForPredictionJob(ref.jobId, {
          pollIntervalMs: opts["pollInterval"] as number | undefined,
          timeoutMs: opts["timeout"] as number | undefined,
        });
        if (output === "json") {
          printJson(results);
        } else {
          _printPredictionResults(results as Record<string, unknown>);
        }
      } else {
        if (output === "json") {
          printJson(ref);
        } else {
          console.log(`Prediction job started: ${ref.jobId}`);
          console.log(`  Poll with: cwm prediction status ${ref.jobId}`);
          console.log(`  Results:   cwm prediction results ${ref.jobId}`);
        }
      }
    } catch (err) { die(err); }
  });

prediction
  .command("optimize-thresholds")
  .description("Optimize autoscaling thresholds against a traffic forecast")
  .requiredOption("--simulation-id <id>", "Simulation ID to optimize")
  .requiredOption("--file <path>", "Path to traffic forecast JSON")
  .option("--test-steps <n>", "Number of simulation ticks to test (default: 100)", parseInt)
  .option("--webhook-url <url>", "HTTPS URL for completion callback")
  .option("--wait", "Block until the job finishes and print results inline")
  .option("--poll-interval <ms>", "Polling interval in ms when --wait is used (default: 2000)", parseInt)
  .option("--timeout <ms>", "Maximum wait time in ms when --wait is used (default: 300000)", parseInt)
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const forecast = readFile(opts["file"] as string);
    const client = makeClient({ baseUrl, apiKey });
    try {
      const ref = await client.optimizePredictionThresholds(
        opts["simulationId"] as string,
        forecast,
        {
          testSteps: opts["testSteps"] as number | undefined,
          webhookUrl: opts["webhookUrl"] as string | undefined,
        },
      );
      if (opts["wait"]) {
        if (output !== "json") {
          console.log(`Prediction job started: ${ref.jobId}`);
          console.log(`  Waiting for completion…`);
        }
        const results = await client.waitForPredictionJob(ref.jobId, {
          pollIntervalMs: opts["pollInterval"] as number | undefined,
          timeoutMs: opts["timeout"] as number | undefined,
        });
        if (output === "json") {
          printJson(results);
        } else {
          _printPredictionResults(results as Record<string, unknown>);
        }
      } else {
        if (output === "json") {
          printJson(ref);
        } else {
          console.log(`Prediction job started: ${ref.jobId}`);
          console.log(`  Poll with: cwm prediction status ${ref.jobId}`);
          console.log(`  Results:   cwm prediction results ${ref.jobId}`);
        }
      }
    } catch (err) { die(err); }
  });

prediction
  .command("status <job-id>")
  .description("Check the status of a prediction job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const job = await makeClient({ baseUrl, apiKey }).getPredictionJob(jobId);
      if (output === "json") {
        printJson(job);
      } else {
        console.log(`Job ${(job as Record<string, unknown>)["id"]}: ${(job as Record<string, unknown>)["status"]}`);
        const j = job as Record<string, unknown>;
        if (j["type"]) console.log(`  Type:      ${j["type"]}`);
        if (j["completedAt"]) console.log(`  Completed: ${j["completedAt"]}`);
        if (j["error"]) console.log(`  Error: ${j["error"]}`);
      }
    } catch (err) { die(err); }
  });

prediction
  .command("results <job-id>")
  .description("Fetch full results of a completed prediction job")
  .action(async (jobId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const results = await makeClient({ baseUrl, apiKey }).getPredictionResults(jobId);
      if (output === "json") {
        printJson(results);
      } else {
        _printPredictionResults(results as Record<string, unknown>);
      }
    } catch (err) { die(err); }
  });

function _printPredictionResults(results: Record<string, unknown>): void {
  const vr = results["validationResult"] as Record<string, unknown> | undefined;
  if (vr) {
    const passed = vr["passed"] as boolean | undefined;
    const score = vr["score"] as number | undefined;
    console.log(`\nValidation: ${passed ? "PASSED" : "FAILED"}${score != null ? `  (score: ${score})` : ""}`);
    const bottlenecks = vr["bottlenecks"] as Array<Record<string, unknown>> | undefined;
    if (bottlenecks && bottlenecks.length > 0) {
      console.log(`\nBottlenecks (${bottlenecks.length}):`);
      for (const b of bottlenecks) {
        console.log(`  [${String(b["severity"] ?? "").toUpperCase()}] ${b["resource"] ?? b["type"]}: ${b["description"] ?? b["message"] ?? ""}`);
      }
    }
    const slaViolations = vr["slaViolations"] as Array<Record<string, unknown>> | undefined;
    if (slaViolations && slaViolations.length > 0) {
      console.log(`\nSLA Violations (${slaViolations.length}):`);
      for (const v of slaViolations) {
        console.log(`  ${v["metric"] ?? v["type"]}: ${v["description"] ?? v["message"] ?? ""}`);
      }
    }
  }
  const bt = results["bestThresholds"] as Record<string, unknown> | undefined;
  if (bt) {
    console.log(`\nOptimized Thresholds:`);
    if (bt["scaleOutCpuThreshold"] != null) console.log(`  Scale-out CPU:        ${bt["scaleOutCpuThreshold"]}%`);
    if (bt["scaleInCpuThreshold"] != null) console.log(`  Scale-in CPU:         ${bt["scaleInCpuThreshold"]}%`);
    if (bt["scaleOutLatencyThreshold"] != null) console.log(`  Scale-out latency:    ${bt["scaleOutLatencyThreshold"]}ms`);
    if (bt["minInstances"] != null) console.log(`  Min instances:        ${bt["minInstances"]}`);
    if (bt["maxInstances"] != null) console.log(`  Max instances:        ${bt["maxInstances"]}`);
  }
  const recs = results["recommendations"] as Array<Record<string, unknown>> | string[] | undefined;
  if (recs && recs.length > 0) {
    console.log(`\nRecommendations:`);
    recs.forEach((r, i) => {
      const text = typeof r === "string" ? r : (r["message"] ?? r["description"] ?? JSON.stringify(r));
      console.log(`  ${i + 1}. ${text}`);
    });
  }
  if (!vr && !bt && !recs) {
    printJson(results);
  }
}

// ------------------------------------------------------------------ //
// keys                                                                 //
// ------------------------------------------------------------------ //

const keys = new Command("keys").description("API key management");
program.addCommand(keys);

keys
  .command("create")
  .description("Create a new API key (requires admin scope)")
  .requiredOption("--name <name>", "Human-readable key label")
  .option("--scopes <scopes>", "Comma-separated scopes (e.g. read,write)", "read,write")
  .option("--expires-at <iso>", "ISO-8601 expiry datetime")
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    const scopes = (opts["scopes"] as string).split(",").map((s) => s.trim());
    try {
      const result = await makeClient({ baseUrl, apiKey }).createApiKey(
        opts["name"] as string,
        { scopes, expiresAt: opts["expiresAt"] as string | undefined },
      );
      if (output === "json") {
        printJson(result);
      } else {
        console.log(`API key created!`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Name:   ${result.name}`);
        console.log(`  Scopes: ${result.scopes.join(", ")}`);
        console.log(`\n  KEY (save this — it won't be shown again):`);
        console.log(`  ${result.key}`);
      }
    } catch (err) { die(err); }
  });

keys
  .command("list")
  .description("List all API keys (requires admin scope)")
  .action(async (opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const list = await makeClient({ baseUrl, apiKey }).listApiKeys();
      if (output === "json") {
        printJson(list);
      } else {
        printTable(
          list.map((k) => ({
            id: k.id,
            name: k.name,
            scopes: k.scopes.join(","),
            active: String(k.isActive),
            prefix: k.keyPrefix,
          })),
          ["id", "name", "scopes", "active", "prefix"],
        );
      }
    } catch (err) { die(err); }
  });

keys
  .command("revoke <key-id>")
  .description("Revoke an API key (requires admin scope)")
  .action(async (keyId: string, opts, cmd) => {
    const { baseUrl, apiKey, output } = globalOpts(cmd);
    try {
      const result = await makeClient({ baseUrl, apiKey }).revokeApiKey(keyId);
      if (output === "json") {
        printJson(result);
      } else {
        console.log(result.message ?? `API key ${keyId} has been revoked.`);
      }
    } catch (err) { die(err); }
  });

program.parse(process.argv);
