# cwm CLI

Command-line interface for the Cloud World Model simulation API.

## Installation

Install globally from GitHub:

```bash
npm install -g "github:canvascloudai/cwm-cli"
cwm --help
```

Or build from the project root (contributors / local dev):

```bash
npm run build:cli
# Then use via node:
node cli/dist/index.cjs --help
# Or link globally:
npm install -g ./cli
cwm --help
```

## Configuration

Save your connection settings once so you don't have to repeat them:

```bash
cwm config set --base-url https://www.cloudworldmodel.ai --api-key cwm_your_key
cwm config show
```

All commands also accept `--base-url` and `--api-key` as inline flags, or read from `CWM_BASE_URL` and `CWM_API_KEY` environment variables.

## Global Flags

| Flag | Description |
|---|---|
| `--base-url <url>` | CWM server URL (overrides config) |
| `--api-key <key>` | API key (overrides config) |
| `--output json` | Machine-parseable JSON output |

---

## Subcommands

### config

```bash
cwm config set --base-url https://www.cloudworldmodel.ai --api-key cwm_abc123
cwm config show
cwm config show --output json
```

### simulate

```bash
# Create a simulation from a JSON file
cwm simulate create --file scenario.json

# Fetch simulation state
cwm simulate get <simulation-id>

# List all simulations
cwm simulate list
cwm simulate list --output json

# Advance one tick (optionally inject traffic)
cwm simulate step <simulation-id>
cwm simulate step <simulation-id> --traffic 1000
cwm simulate step <simulation-id> --output json
```

**Example `scenario.json`:**
```json
{
  "name": "My Cluster",
  "resources": [
    { "id": "web", "type": "compute", "name": "Web Server", "provider": "aws" },
    { "id": "db",  "type": "database", "name": "PostgreSQL", "provider": "aws" }
  ],
  "connections": [{ "sourceId": "web", "targetId": "db" }]
}
```

### rl

```bash
# Create an RL environment for a simulation
cwm rl create <simulation-id>
cwm rl create <simulation-id> --max-steps 500

# Execute one RL step (action: scale_up | scale_down | no_op | scale_out | scale_in | adjust_threshold)
cwm rl step <env-id> scale_up
cwm rl step <env-id> no_op --output json

# Reset for a new episode
cwm rl reset <env-id>
```

### chaos

```bash
# List built-in scenarios
cwm chaos scenarios

# Run a chaos experiment
cwm chaos run <simulation-id> --scenario zone_failure
cwm chaos run <simulation-id> --scenario database_crash --duration 200

# Poll job status
cwm chaos status <job-id>

# Fetch full results once completed
cwm chaos results <job-id>
cwm chaos results <job-id> --output json
```

Available built-in scenario IDs: `zone_failure`, `database_crash`, `network_partition`, `cascading_failure`, `random_instance_failure`, `database_slowdown`, `cpu_stress`.

### multicloud

```bash
# Start a multi-cloud strategy exploration
cwm multicloud explore --file workload.json

# Poll status
cwm multicloud status <job-id>

# Fetch ranked strategies
cwm multicloud results <job-id>
cwm multicloud results <job-id> --output json
```

**Example `workload.json`:**
```json
{
  "computeInstances": 10,
  "databaseInstances": 2,
  "storageGB": 500,
  "trafficRPS": 5000,
  "latencyRequirementMs": 200,
  "primaryRegion": "us-east-1"
}
```

### keys

```bash
# Create an API key (requires admin scope)
cwm keys create --name "my-agent" --scopes read,write
cwm keys create --name "ci-bot" --scopes read,write --expires-at 2026-12-31T00:00:00Z

# List keys
cwm keys list
cwm keys list --output json

# Revoke a key
cwm keys revoke <key-id>
```

---

## Machine-Readable Output

Add `--output json` to any command to get clean JSON on stdout:

```bash
cwm simulate step my-sim-id --output json | jq '.metrics.cpuUsage'
cwm chaos results my-job-id --output json | jq '.resilienceScore.overall'
cwm keys list --output json | jq '.[].name'
```

## RL Training Loop Example

```bash
# 1. Create simulation
SIM=$(cwm simulate create --file scenario.json --output json | jq -r '.id')

# 2. Create RL environment — response is { environment, observation }
ENV=$(cwm rl create $SIM --output json | jq -r '.environment.id')

# 3. Run 10 steps
for i in $(seq 1 10); do
  cwm rl step $ENV scale_up --output json | jq '{reward: .reward.total, done: .done}'
done

# 4. Reset
cwm rl reset $ENV
```
