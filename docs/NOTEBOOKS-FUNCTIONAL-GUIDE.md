# The Notebooks, Explained — A Functional Guide for New Joiners

**Who this is for:** you have just joined, you know some programming, and you have been
pointed at `capstone_project/notebooks/`. You may never have used AWS, Jupyter, or an AI
agent framework before. This document explains **what each notebook does, why it exists,
and what the code is actually doing**, line group by line group.

You do not need to read this end to end before touching anything. Read the section for the
notebook you are about to run.

---

## Table of contents

1. [The 60-second summary](#1-the-60-second-summary)
2. [Vocabulary you need first](#2-vocabulary-you-need-first)
3. [How these notebooks work mechanically](#3-how-these-notebooks-work-mechanically)
4. [The shared helpers every notebook imports](#4-the-shared-helpers-every-notebook-imports)
5. [How the notebooks hand data to each other](#5-how-the-notebooks-hand-data-to-each-other)
6. Notebook-by-notebook walkthrough
   - [01 — Foundation & AWS Setup](#notebook-01--foundation--aws-setup)
   - [02 — Runtime Setup](#notebook-02--runtime-setup)
   - [03 — Gateway Integration](#notebook-03--gateway-integration)
   - [04 — Memory Implementation](#notebook-04--memory-implementation)
   - [05 — Identity & OAuth](#notebook-05--identity--oauth)
   - [06 — Code Interpreter](#notebook-06--code-interpreter)
   - [07 — Browser Tools](#notebook-07--browser-tools)
   - [08 — Final Integration](#notebook-08--final-integration)
   - [09 — Observability Lab](#notebook-09--observability-lab)
   - [10 — Policy Lab](#notebook-10--policy-lab)
   - [11 — Evaluations Lab](#notebook-11--evaluations-lab)
7. [Cost and cleanup — read this before you run anything](#7-cost-and-cleanup)
8. [Troubleshooting the things that actually go wrong](#8-troubleshooting)
9. [Glossary](#9-glossary)

---

## 1. The 60-second summary

The notebooks build **one application, in eleven steps**: an *AI Travel Companion*. It is a
chatbot that can plan a trip to Italy, look up real flights and weather, remember that you
are vegetarian, do budget arithmetic, browse a website, and save your itinerary to your
Google Drive.

Each notebook adds **one capability** and then **saves a small JSON file** so the next
notebook can pick up where it left off.

| # | Notebook | Capability it adds | One-line summary |
|---|----------|--------------------|------------------|
| 01 | `01-foundation.ipynb` | — | Check your laptop and AWS account are ready |
| 02 | `02-runtime-setup.ipynb` | **Runtime** | Write an agent, ship it to AWS, talk to it |
| 03 | `03-gateway-integration.ipynb` | **Gateway** | Turn 3 public REST APIs into agent tools |
| 04 | `04-memory-implementation.ipynb` | **Memory** | Remember user preferences across chats |
| 05 | `05-identity-oauth.ipynb` | **Identity** | Let the agent act on the user's Google Drive |
| 06 | `06-code-interpreter.ipynb` | **Code Interpreter** | Let the agent run Python in a sandbox |
| 07 | `07-browser-tools.ipynb` | **Browser Tools** | Let the agent drive a real web browser |
| 08 | `08-final-integration.ipynb` | **Orchestration** | Combine everything into one deployed agent |
| 09 | `09-agentcore_observability_lab.ipynb` | Observability | See what the agent did, in CloudWatch |
| 10 | `10-agentcore_policy_lab.ipynb` | Policy | Block tool calls with rules the LLM cannot talk its way past |
| 11 | `11-agentcore_evaluations_lab.ipynb` | Evaluations | Score the agent's answers automatically |

Notebooks **01–08** are the course project and build on each other in order.
Notebooks **09–11** are self-contained labs — each deploys its own tiny agent, demonstrates
one production concern, and cleans up after itself. They use an insurance/weather/math
example rather than travel, because the point is the *mechanism*, not the domain.

---

## 2. Vocabulary you need first

Nine terms carry most of the weight. If these are clear, the notebooks read easily.

**Agent.** A loop around a large language model (LLM). You give the model a question and a
list of *tools*. The model either answers, or says "call `get_weather` with `Rome,IT`". The
loop calls that function, hands the result back, and asks the model again. It repeats until
the model produces a final answer. Everything else in this repo is plumbing around that loop.

**Tool.** A normal function the model is allowed to call, described well enough that the
model knows when to call it. In this repo a tool is declared with the Strands SDK:

```ts
const getDestinationInfo = tool({
  name: "get_destination_info",                         // what the model calls it
  description: "Get basic information about a travel destination",  // when to call it
  inputSchema: z.object({ destination: z.string() }),   // what arguments are legal
  callback: ({ destination }) => destinations[destination.toLowerCase()],  // what runs
});
```

The `description` is not a comment — it is a prompt. A vague description means the model
picks the wrong tool. The `inputSchema` (written with [Zod](https://zod.dev)) is both
runtime validation *and* the JSON schema the model is shown.

**Bedrock.** The AWS service that hosts LLMs. This course uses Anthropic's
`us.anthropic.claude-sonnet-4-6` — a small, fast, cheap model, which is the
right choice when you are running the same notebook cell fifteen times while debugging.

**AgentCore.** A set of AWS services *around* Bedrock for running agents in production:
Runtime, Gateway, Memory, Identity, Code Interpreter, Browser Tools, Observability, Policy,
Evaluations. One notebook per service, roughly.

**Runtime.** AWS's managed place to run your agent. You hand it a folder of code; it builds
a Linux container, stores it, and gives you an ARN you can invoke. You never run or patch a
server.

**Gateway.** A proxy that turns an external REST API into agent tools. You hand it an
OpenAPI specification (a JSON description of an API's endpoints) and an API key; it exposes
each endpoint as a callable tool and keeps the key hidden from the agent.

**MCP (Model Context Protocol).** The wire format the Gateway speaks. It is
[JSON-RPC 2.0](https://www.jsonrpc.org/specification) over HTTP POST — you send
`{"jsonrpc":"2.0","method":"tools/list"}` to list tools, or `"tools/call"` to call one. You
will see this exact shape hand-written in notebooks 03, 08 and 10, so it is worth a look:

```ts
body: JSON.stringify({
  jsonrpc: "2.0",
  id: "test-weather",
  method: "tools/call",
  params: { name: "WeatherSearch___getCurrentWeather", arguments: { q: "Rome,IT" } },
})
```

**ARN (Amazon Resource Name).** AWS's globally unique ID for a thing, e.g.
`arn:aws:lambda:us-east-1:123456789012:function:MyFn`. When code passes identifiers around,
it is usually passing ARNs.

**IAM role.** A bag of permissions that a *service* (not a person) assumes. When the Gateway
calls your Lambda, it does so as its own role — so that role needs `lambda:InvokeFunction`.
Most "access denied" errors in these notebooks are a missing line in a role. Notebook 10
deals with this head-on.

---

## 3. How these notebooks work mechanically

### They are TypeScript, not Python

This is the surprise for most people. `.ipynb` files are usually Python. These run
**TypeScript on [Deno](https://deno.com)'s own Jupyter kernel**. There is no `pip`, no
`venv`, no `requirements.txt`.

- Dependencies live in the root `deno.json`, pinned to exact versions, and are cached by
  `./setup.sh`.
- In VS Code you install the **Jupyter** and **Deno** extensions, then click *Select Kernel*
  → *Jupyter Kernel…* → **Deno**. If "Deno" is not offered, run `deno jupyter --install --force`
  and reload the window.
- Every cell is an ES module. **Top-level `await` works**, which is why you see
  `await loadEnv()` sitting directly in a cell with no wrapping function.
- A `const` declared in cell 3 is visible in cell 20. Re-running cell 3 after editing it is
  fine; re-running it *unchanged* can occasionally complain about redeclaration — restart the
  kernel if the notebook gets confused.

### The first cell of almost every notebook

```ts
Deno.env.set("AWS_REGION", "us-east-1");

// APPROACH A: Use credentials
// Deno.env.set("AWS_ACCESS_KEY_ID", "your_access_key");
// ...
// APPROACH B: Use AWS SSO profile
// Deno.env.set("AWS_PROFILE", "your_profile");
```

This is where you tell AWS who you are. Two ways:

- **Approach A** — paste temporary access keys. Fast, but they expire and you must never
  commit them.
- **Approach B** — name an AWS SSO profile you have already logged into with
  `aws sso login --profile your_profile`. Preferred. Note the commented-out loop that
  *deletes* the key variables: if both are set, the keys win, so they have to go.

Everything in the course defaults to **`us-east-1`**. If you change the region, change it
everywhere, and confirm the AgentCore features and the Bedrock model are available there.

### How AWS credentials are actually found

```ts
import { defaultProvider } from "@aws-sdk/credential-provider-node";
const credentials = await defaultProvider()();
```

`defaultProvider()` is the AWS SDK's standard credential chain: it checks environment
variables, then the shared `~/.aws/credentials` file, then the SSO cache, then instance
metadata — first hit wins. Every AWS client in the repo uses it implicitly; notebook 01 just
calls it directly so it can print which key it found.

---

## 4. The shared helpers every notebook imports

`capstone_project/shared/notebook.ts` exists because Deno's Jupyter kernel has no IPython
"magics" (`%store`, `%%writefile`, `!command`). It provides four replacements.

| Python / IPython | Here | What it does |
|------------------|------|--------------|
| `load_dotenv()` | `await loadEnv()` | Reads the repo-root `.env` into `Deno.env` |
| `%%writefile path` | `await writeFile(path, source)` | Writes a file, creating parent directories |
| `%store x` / `%store -r x` | `await state.set(k, v)` / `state.get(k)` | Key-value store that survives kernel restarts |
| `!ls` / `subprocess.run` | `await sh("deno", ["--version"])` | Runs a command **and prints its output** |

A few details worth internalising:

- **`writeFile` resolves relative paths against the notebooks directory**, not your current
  working directory. That is why `"../backend/runtime/simple_agent/travel_agent.ts"` means
  the same thing no matter where the kernel started. It also prints the absolute path it
  wrote, so you can click through to the file.
- **`state`** is a single JSON file, `notebooks/.notebook-state.json`. `state.require(key, hint)`
  throws with a message naming the notebook you forgot to run — a much better failure than
  `undefined is not an object` six cells later.
- **`sh` prints what it captured** on purpose. The Deno kernel does not forward a child
  process's stdout to the notebook ([denoland/deno#20555](https://github.com/denoland/deno/issues/20555)),
  so without this you would see nothing.
- **`maskKey("abcd1234wxyz")` → `"********wxyz"`.** Used everywhere a secret would otherwise
  be printed, because notebook outputs get committed to git.

### The toolkit

`capstone_project/toolkit/` is the course's own client library. Python has an official
`bedrock-agentcore-starter-toolkit`; TypeScript does not, so this repo reimplements it on top
of the AWS SDK v3. Import from `../toolkit/mod.ts`:

| Class | Used in | What it wraps |
|-------|---------|---------------|
| `Runtime` | 02, 05, 08, 09, 11 | Build + deploy + invoke an agent container |
| `GatewayClient` | 03, 10 | Create gateways, targets, Cognito OAuth |
| `MemoryClient` | 04 | Create memory resources, write events, retrieve records |
| `IdentityClient` | 05 | OAuth2 credential providers, workload identity |
| `PolicyClient` | 10 | Policy engines, Cedar policies, NL→Cedar |
| `ObservabilityClient` | 09, 11 | Query spans and logs out of CloudWatch |
| `Evaluation` | 11 | Built-in and custom evaluators, on-demand and online runs |

Each class mirrors its Python counterpart method-for-method — same names, camelCased, with an
options object instead of keyword arguments — so course material written for Python still reads
correctly.

---

## 5. How the notebooks hand data to each other

Nothing is passed in memory. Each notebook writes a small JSON file into
`capstone_project/notebooks/environments/`, and later notebooks read it. This is why
**order matters** and why re-running notebook 08 after wiping `environments/` fails fast
with a useful message.

```
02 ──▶ environments/runtime_info.json       (agent ARN, ECR URI, status)
03 ──▶ environments/gateway_info.json       (MCP endpoint, OAuth client id/secret, tool names)
03 ──▶ environments/cognito_config.json     (user pool, app client, token endpoint)
04 ──▶ environments/memory_info.json        (memory id, user id, session id)
05 ──▶ environments/identity_info.json      (OAuth2 provider, callback URL)
08 ──▶ environments/final_deployment_info.json
09 ──▶ environments/observability_lab_config.json
10 ──▶ environments/policy_lab_config.json
11 ──▶ environments/evaluation_lab_config.json
```

Two more files live alongside them:

- **`notebooks/.notebook-state.json`** — the `state` store described above. Most notebooks
  write to *both* the JSON file and the state store, so a restarted kernel can recover.
- **`notebooks/.bedrock_agentcore.json`** — written by `Runtime.configure()`. It remembers,
  per agent name, the entrypoint, source directory, region, environment variables and the
  deployed agent id. This is how `launch()` in one cell knows what `configure()` set up in
  the previous cell, and how `status()` works after a kernel restart. Notebook 11 deliberately
  deletes its own entry from this file before deploying, so a stale agent id from a deleted
  runtime cannot poison the deployment.

Notebook 08 reads these with a helper that turns a missing file into a sentence you can act on:

```ts
async function loadResourceConfig<T>(filename: string, createdBy: string): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(`environments/${filename}`)) as T;
  } catch {
    throw new Error(`Missing environments/${filename} — run ${createdBy} first.`);
  }
}
```

Copy this pattern. "Run notebook 03 first" beats a stack trace.

---

# Notebook 01 — Foundation & AWS Setup

**Goal:** prove your machine and AWS account can do everything the next ten notebooks need,
*before* you spend twenty minutes on a deployment that was going to fail anyway.

**Creates:** nothing. Read-only. Safe to run repeatedly.

### What the cells do

**Cell: setup check.** A one-liner that tests whether `../../deno.json` exists, which tells
you the notebook is being run from inside the repo and `./setup.sh` has been run.

**Cell: AWS configuration.** The credentials cell described in §3.

**Cell: credential verification.**

```ts
await loadEnv();
const credentials = await defaultProvider()();
console.log(`AWS Access Key: ${credentials.accessKeyId.slice(0, 8)}...`);
```

Loads `.env`, then resolves credentials and prints only the first 8 characters — enough to
tell *which* key was picked up, not enough to leak it.

**Cell: API key validation.** Checks three optional third-party keys:

| Variable | Service | Used by |
|----------|---------|---------|
| `AVIATIONSTACK_API_KEY` | [aviationstack](https://aviationstack.com/) — flight data | notebook 03 |
| `OPENWEATHERMAP_API_KEY` | [OpenWeatherMap](https://openweathermap.org/api) — weather | notebook 03 |
| `EXCHANGERATE_API_KEY` | [ExchangeRate-API](https://www.exchangerate-api.com/) — currency | notebook 03 |

All three have free tiers. Put them in a `.env` file at the **repo root** (not in
`notebooks/`). Notebook 01 only *warns* if they are missing; notebook 03 **throws**, because
it genuinely cannot proceed.

**Cell: environment validation.** The most useful cell in the notebook. `checkEnvironment()`
runs four independent checks and collects `[status, message]` pairs rather than throwing, so
you see *all* the problems at once instead of fixing them one restart at a time:

1. **Deno ≥ 2.9** — parses `Deno.version.deno` and compares major/minor.
2. **Jupyter kernel installed** — shells out to `deno jupyter` and looks for the string
   `"already installed"` in the combined stdout+stderr. A little crude, but reliable.
3. **AWS credentials work** — calls STS `GetCallerIdentity`, the standard "who am I?" call.
   It needs no special permission, so it isolates *credentials* from *permissions*.
4. **Bedrock is reachable** — calls `ListFoundationModels`. Note this check is hardcoded to
   `region: "us-west-2"` while the rest of the course runs in `us-east-1`; it is checking
   that Bedrock works at all, not that your working region is ready.

It then prints `passed/total`. **Do not move on until this is 4/4.**

### Common failures

- *"Bedrock access: AccessDeniedException"* — your IAM user or role needs Bedrock
  permissions, and in the console you may need to request access to the Anthropic models.
- *"Deno Jupyter kernel missing"* — run `./setup.sh`, or `deno jupyter --install --force`.

---

# Notebook 02 — Runtime Setup

**Goal:** the full lifecycle of a deployed agent — write it, test it locally, ship it to AWS,
talk to it over the network.

**Creates:** an ECR repository, two IAM roles, a CodeBuild project, and an AgentCore Runtime
named `travel_companion_basic`. **Deployment takes 5–10 minutes.**

**Writes:** `../backend/runtime/simple_agent/{travel_agent.ts,deno.json}`,
`environments/runtime_info.json`.

### Step 2 — three tools

The agent gets three tools, deliberately simple so you can see tool-calling work without any
network dependency:

```ts
const calculateBudget = tool({
  name: "calculate_budget",
  description: "Calculate daily budget allocation for travel",
  inputSchema: z.object({
    total_budget: z.number().describe("Total travel budget"),
    days: z.number().describe("Number of days"),
  }),
  callback: ({ total_budget, days }) => ({
    daily_budget: total_budget / days,
    allocation: {
      flights:    total_budget * 0.24,
      hotels:     total_budget * 0.36,
      food:       total_budget * 0.20,
      activities: total_budget * 0.16,
      buffer:     total_budget * 0.04,
    },
  }),
});
```

The percentages are a fixed heuristic (24/36/20/16/4 = 100%), not a calculation. The point is
that **arithmetic belongs in code, not in the model** — LLMs are unreliable at arithmetic, and
this is the cheapest possible fix. Notebook 06 shows the expensive, general fix.

The other two: `get_travel_preferences` returns a hardcoded object (notebook 04 replaces it
with real memory) and `get_destination_info` looks up a three-city dictionary, returning
`{ error: "Destination not found" }` for anything else. Returning a structured error rather
than throwing lets the model explain the problem to the user instead of crashing the request.

### Step 3 — the agent

```ts
const model = new BedrockModel({ modelId: "us.anthropic.claude-sonnet-4-6" });
const travelAgent = new Agent({ model, tools: [...], systemPrompt });
```

The **system prompt** is the agent's standing instructions — its role, expertise, and
behavioural rules ("Always ask clarifying questions"). It is sent with every request. Editing
it is the fastest way to change agent behaviour, and worth experimenting with.

### Step 4 — test locally first

```ts
const result = await travelAgent.invoke(userInput);
console.log(result.toString());
```

`invoke()` runs the whole agent loop and returns when the model has a final answer. Watch the
budget test: the model receives "I have $5000 for 10 days", decides to call
`calculate_budget`, gets the object back, and writes prose around it.

**Test locally before deploying.** A local `invoke()` takes seconds; a deployment takes ten
minutes.

### Step 5 — write the deployable folder

Two `writeFile` cells produce a **self-contained** folder:

- `travel_agent.ts` — the same three tools and agent again, plus a `BedrockAgentCoreApp`
  wrapper.
- `deno.json` — every dependency pinned to an exact version. This is the container's
  "requirements file".

**Why is the code duplicated instead of imported?** Because the folder is zipped and shipped
on its own. It cannot import from `../../shared/` — that path does not exist inside the
container. This duplication is deliberate, and it recurs in notebooks 05, 08, 09 and 11.

The wrapper turns the agent into an HTTP service:

```ts
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ prompt: z.string().default("") }),
    process: async ({ prompt }) => (await travelAgent.invoke(prompt)).toString(),
  },
});
app.run();
```

`requestSchema` validates the incoming JSON payload; `process` is your handler. `app.run()`
starts a server that AgentCore Runtime knows how to talk to.

### Step 6 — configure and launch

```ts
const agentcoreRuntime = new Runtime();
await agentcoreRuntime.configure({
  entrypoint: "travel_agent.ts",      // relative to sourceDir
  autoCreateExecutionRole: true,      // make the IAM role for me
  autoCreateEcr: true,                // make the container registry for me
  requirementsFile: "deno.json",
  region,
  agentName: "travel_companion_basic",
  sourceDir: "../backend/runtime/simple_agent",
});
const launchResult = await agentcoreRuntime.launch();
```

`configure()` only records intent — it writes `.bedrock_agentcore.json` and returns. The work
happens in `launch()`, which:

1. Creates (or reuses) an ECR repository — ECR is AWS's Docker image registry.
2. Creates (or reuses) two IAM roles: one the agent runs as, one CodeBuild builds as. The
   execution role policy is defined in `toolkit/runtime.ts` (`executionRolePolicy`) and
   already includes the Identity and Secrets Manager permissions notebook 08 needs.
3. Zips `sourceDir`, uploads it to S3, and runs an **AWS CodeBuild** job that builds an
   arm64 Linux container and pushes it to ECR.
4. Calls `CreateAgentRuntime` with the image URI.

**The build happens in the cloud, so you do not need Docker installed.** This is a real
difference from the Python version of this course.

`launch()` returns `{ agentId, agentArn, ecrUri, imageTag, buildId, executionRoleArn }`.

### Step 6b — the polling loop

```ts
const endStatus = ["READY", "CREATE_FAILED", "DELETE_FAILED", "UPDATE_FAILED"];
while (!endStatus.includes(status)) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  statusResponse = await agentcoreRuntime.status();
  status = (statusResponse.endpoint as { status?: string })?.status ?? "UNKNOWN";
}
```

This exact loop appears in notebooks 02, 05, 08, 09 and 11. Three things to notice, because
you will write loops like this yourself:

- It waits for any **terminal** state, not just success — otherwise a failed deployment loops
  forever.
- `setTimeout` wrapped in a `Promise` is how you sleep in JavaScript. There is no `sleep()`.
- `?? "UNKNOWN"` guards the case where the endpoint object is not yet populated.

### Steps 7–9 — invoke, converse, save

```ts
const invokeResponse = await agentcoreRuntime.invoke({ prompt: "..." });
```

This is now a network call to AWS, not a local function call — so it is slower, and it is
billed. The multi-turn loop sends four messages in sequence and truncates each response to
200 characters for readability.

Finally the important identifiers are saved to `environments/runtime_info.json` **and** to
the state store, because a kernel restart loses `launchResult` but not the file.

---

# Notebook 03 — Gateway Integration

**Goal:** give the agent real data. Three public REST APIs become agent tools without you
writing a single HTTP client.

**Creates:** a Cognito user pool + app client, a gateway named `TravelMateGateway`, three
gateway targets, and three API-key credential providers (each backed by a Secrets Manager
secret).

**Writes:** `environments/gateway_info.json`, `environments/cognito_config.json`.

**Requires:** all three API keys. This notebook throws if any is missing.

### The idea

Without a Gateway you would, for every API: write a `fetch` wrapper, store the key, handle
errors, and describe the function to the model. With a Gateway you hand AWS an **OpenAPI
specification** — a JSON file describing an API's endpoints, parameters and responses — and it
generates the tools.

The specs live in `capstone_project/backend/gateway/openapi_specs/` and were written for this
course; they are trimmed versions of each vendor's real API.

### Step 3 — reading the specs

```ts
const specs = {
  "Aviationstack (Flights)": await loadOpenapiSpec("aviationstack.json"),
  "OpenWeatherMap (Weather)": await loadOpenapiSpec("openweathermap.json"),
  "ExchangeRate-API (Currency)": await loadOpenapiSpec("exchangerate.json"),
};
```

The cell then walks `spec.paths` and prints every `METHOD /path — operationId`. Read that
output — those `operationId`s become the second half of each tool name.

### Step 4 — OAuth with Cognito

```ts
const cognitoResult = await setupCognitoOauth(client, GATEWAY_NAME, REGION);
await activateOauthClientCredentials(cognitoResult.client_info, REGION);
```

The gateway will not accept anonymous requests. **Amazon Cognito** issues the tokens. Two
helpers from `backend/cognito_config.ts`:

- `setupCognitoOauth` creates a user pool and app client — or loads the saved config if a
  previous run already made one, so re-running does not litter your account with pools.
- `activateOauthClientCredentials` makes sure the app client allows the
  **`client_credentials`** OAuth flow.

`client_credentials` is the machine-to-machine flow: no human, no browser, no login page. You
POST your client id and secret to a token endpoint and get back a bearer token. That is all
the gateway needs. (Notebook 05 uses the *other* flow — the one with a browser and a consent
screen.)

### Step 4b — create the gateway, idempotently

```ts
let gateway;
try {
  gateway = await client.createMcpGateway({
    name: GATEWAY_NAME,
    roleArn: null,                 // auto-create the execution role
    authorizerConfig: cognitoResult.authorizer_config,
    enableSemanticSearch: true,
  });
} catch {
  const gateways = await client.client.send(new ListGatewaysCommand({}));
  const existing = gateways.items?.find((g) => g.name === GATEWAY_NAME);
  gateway = await client.client.send(new GetGatewayCommand({ gatewayIdentifier: existing.gatewayId }));
}
```

**Create-or-fetch** is the dominant pattern in this repo, and the reason you can re-run cells.
Note `client.client` — the toolkit deliberately exposes the raw AWS SDK client so you can
reach any API it does not wrap.

`enableSemanticSearch: true` lets an agent search the tool catalogue by meaning rather than
receiving every tool definition. It matters once you have dozens of tools.

### Step 5 — adding targets

Each API becomes a **target**:

```ts
const weatherTarget = await client.createMcpGatewayTarget({
  gateway,
  name: "WeatherSearch",
  targetType: "openApiSchema",
  targetPayload: { inlinePayload: JSON.stringify(specs["OpenWeatherMap (Weather)"]) },
  credentials: {
    apiKey: apiKeys.OPENWEATHERMAP_API_KEY!,
    credentialLocation: "QUERY_PARAMETER",
    credentialParameterName: "appid",
  },
});
```

`credentialLocation` and `credentialParameterName` tell the gateway **where each vendor wants
its key** — OpenWeatherMap wants `?appid=...`, aviationstack wants `?access_key=...`. The
gateway stores the key in Secrets Manager behind an AgentCore *credential provider* and
injects it on every call. The agent never sees it.

The resulting tool names are `TargetName___operationId` — three underscores:

```
FlightSearch___getFlights
WeatherSearch___getCurrentWeather
WeatherSearch___getWeatherForecast
ExchangeRate___getExchangeRates
ExchangeRate___convertCurrency
```

Note the code reads `weatherTarget.name` back from the response rather than reusing the string
it sent — AWS may return a suffixed name, and the tool names must match exactly.

### Step 6 — testing, and the ExchangeRate special case

`testGatewayTool` hand-writes an MCP JSON-RPC call over `fetch` (see §2). It logs failures and
returns `null` rather than throwing, so one dead API does not stop the notebook.

One target is awkward. The ExchangeRate OpenAPI spec declares `api_key` as a *regular request
parameter*, so the caller has to supply it — and the notebook no longer has it in a variable
it trusts. So it reads the key back out of AWS:

```ts
const providers = await client.client.send(new ListApiKeyCredentialProvidersCommand({ maxResults: 100 }));
const provider  = providers.credentialProviders?.find((p) => p.name?.startsWith("ExchangeRate-ApiKey"));
const details   = await client.client.send(new GetApiKeyCredentialProviderCommand({ name: provider.name! }));
const secret    = await new SecretsManagerClient({ region: REGION })
  .send(new GetSecretValueCommand({ SecretId: details.apiKeySecretArn?.secretArn }));
return JSON.parse(secret.SecretString!).api_key_value;
```

Four hops: **list providers → get provider → read its secret ARN → fetch the secret**. This
exact logic reappears in notebook 08 as the reusable `IdentityHelper` class, used by both the
notebook and the deployed agent so they read the key identically.

### What gets saved

`gateway_info.json` holds the MCP endpoint, the OAuth client id **and secret**, the scope, and
the list of tool names. Notebook 08 turns these into environment variables for the deployed
agent. Be aware the secret is in that file — `environments/` should not be pushed to a public
repository.

---

# Notebook 04 — Memory Implementation

**Goal:** make the agent remember you between conversations.

**Creates:** an AgentCore Memory resource named `TravelMateMemory` with three strategies.

**Writes:** `environments/memory_info.json`.

**Shortest notebook of the eight — and the one with the most counter-intuitive behaviour.**

### The idea

An LLM is stateless. Everything it "knows" about the conversation was in the prompt you just
sent. Memory is the service that decides what is worth keeping, extracts it, and lets you
search it later.

### Step 3 — strategies

```ts
const strategies: MemoryStrategyDict[] = [
  { [StrategyType.USER_PREFERENCE]: {
      name: "TravelPreferences",
      namespaces: ["travel/user/{actorId}/preferences"] } },
  { [StrategyType.SEMANTIC]: {
      name: "TravelSemantic",
      namespaces: ["travel/user/{actorId}/semantic"] } },
  { [StrategyType.SUMMARY]: {
      name: "TravelSummary",
      namespaces: ["travel/user/{actorId}/summary/{sessionId}"] } },
];
```

A **strategy** is a rule for what to extract from a conversation:

| Strategy | Extracts | Example |
|----------|----------|---------|
| `USER_PREFERENCE` | Stable likes, dislikes, constraints | "prefers mid-range hotels" |
| `SEMANTIC` | Facts and trip details | "is flying to Rome in June" |
| `SUMMARY` | A rolling summary of the conversation | "user planned a 10-day Italy trip" |

A **namespace** is the folder path a memory is filed under. `{actorId}` and `{sessionId}` are
placeholders AWS substitutes at write time. Note that the summary namespace includes
`{sessionId}` — summaries are per-conversation, while preferences are per-user and outlive any
one chat. That is a design decision, and it is the interesting part of this cell.

### Step 3b — create, idempotently

```ts
try {
  const memory = await client.createMemoryAndWait({ name: MEMORY_NAME, strategies, eventExpiryDays: 365 });
  memoryId = (memory.id ?? memory.memoryId)!;
} catch (error) {
  if (error instanceof Error && error.message.includes("already exists")) {
    const memories = await client.listMemories();
    const existing = memories.find((m) => (m.id ?? m.memoryId ?? "").startsWith(MEMORY_NAME));
    memoryId = (existing?.id ?? existing?.memoryId)!;
  } else { throw error; }
}
```

`createMemoryAndWait` creates the resource **and polls until it is ACTIVE**, so the next cell
can use it. `eventExpiryDays: 365` means raw events are deleted after a year — a retention
decision you should make consciously, not a default to copy blindly.

The `m.id ?? m.memoryId` pattern you see throughout the toolkit is defensive: the AgentCore
APIs have used both field names, so the code accepts either.

### Step 5 — seeding

```ts
import { travelInteractions } from "../backend/memory/memory_setup.ts";
await client.createEvent({ memoryId, actorId: USER_ID, sessionId: "preference_setup", messages: travelInteractions });
```

`travelInteractions` is eight `[text, role]` pairs — a fake conversation where the user says
they like mid-range hotels, are vegetarian, budget $3000–5000, and prefer museums to
nightlife. Seeding gives you something to retrieve without chatting for ten minutes first.

An **event** is a raw conversation turn. You write events; AWS extracts memories from them
asynchronously.

### Step 6 — the 30-second sleep, and why it is honest

```ts
await new Promise((resolve) => setTimeout(resolve, 30_000));

try {
  const memories = await client.retrieveMemories({
    memoryId,
    namespace: `travel/user/${USER_ID}/preferences`,
    query: "vegetarian food preferences",
    topK: 3,
  });
  // ...
} catch (error) {
  console.log("This is normal - memories may take time to process");
}
```

**This is the single most important thing to understand about Memory: extraction is
asynchronous.** Writing an event does not make a memory. An LLM runs over the event in the
background and *then* the memory becomes searchable. The delay is usually seconds but is not
guaranteed.

So the notebook sleeps 30 seconds, then retrieves — and wraps the retrieval in a try/catch
that says "this is normal". **If you get zero memories back on the first run, that is not a
bug.** Wait a minute and re-run the cell.

`retrieveMemories` is a semantic search: `query: "vegetarian food preferences"` finds the
memory about being vegetarian even though the stored text does not contain the word "query".
`topK: 3` asks for the three best matches.

---

# Notebook 05 — Identity & OAuth

**Goal:** let the agent do something **on the user's behalf** — write a file into *your*
Google Drive — without ever holding your Google password.

**Creates:** a Cognito test user, a Google OAuth2 credential provider, and an AgentCore
Runtime named `travel_agent_google_drive`.

**Writes:** `../backend/identity/runtime/{oauth2_callback_server.ts,travel_agent_google_drive.ts,deno.json}`,
`environments/identity_info.json`.

**The hardest notebook of the eleven.** It has manual setup in the Google Cloud Console, a
server you start in a second terminal, and two different OAuth flows running at once. Budget
time, and read this section before you start clicking.

### Two authentications, not one

This is the thing that confuses everybody. There are two separate flows:

| | **Inbound** | **Outbound** |
|---|---|---|
| Question | "Is this caller allowed to use my agent?" | "May the agent touch this user's Google Drive?" |
| Provider | Cognito | Google |
| Flow | Username + password | OAuth 2.0 three-legged (3LO) |
| Human involved? | No (scripted here) | **Yes — a browser consent screen** |

### Step 2 — a Cognito test user

Reuses the pool notebook 03 made, adds `testuser` with a temporary password, then immediately
sets a permanent one (`MyPassword123!`) via `AdminSetUserPasswordCommand`, and enables the
`USER_PASSWORD_AUTH` flow so a script can log in. `MessageAction: "SUPPRESS"` stops Cognito
emailing anybody.

These are lab credentials in a throwaway pool. Never do this in an account that matters.

### Step 3 — Google Cloud Console (manual)

Markdown instructions, no code: create a project, enable the Drive API, configure the consent
screen as **External**, add yourself as a test user, and create a **Web application** OAuth
client. Copy the client id and secret into `.env` as `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`.

You cannot fill in the redirect URI yet — AWS generates it in the next step.

### Step 4 — the credential provider, and the chicken-and-egg

```ts
googleProvider = await identityClient.createOauth2CredentialProvider({
  name: "google-drive-provider",
  credentialProviderVendor: "GoogleOauth2",
  oauth2ProviderConfigInput: {
    googleOauth2ProviderConfig: { clientId: googleClientId, clientSecret: googleClientSecret },
  },
});
console.log(`AgentCore Callback URL: ${googleProvider.callbackUrl}`);
```

**Stop and read the printed callback URL. Paste it into your Google OAuth client's
"Authorized redirect URIs" and save.** If you skip this, the consent screen will fail with
`redirect_uri_mismatch` later and the error will not mention this cell.

The provider stores your Google client secret in AWS and hands out access tokens; the agent
code never sees the secret.

### Step 5 — the local callback server

This cell `writeFile`s a small HTTP server that you then run **on your own laptop**:

```ts
export const OAUTH2_CALLBACK_SERVER_PORT = 9090;

handler = async (request: Request): Promise<Response> => {
  if (request.method === "POST" && url.pathname === "/userIdentifier/token") {
    this.#userTokenIdentifier = await request.json();   // remember who is authorising
    return new Response(null, { status: 200 });
  }
  if (request.method === "GET" && url.pathname === "/ping") {
    return Response.json({ status: "success" });        // readiness probe
  }
  if (request.method === "GET" && url.pathname === "/oauth2/callback") {
    const sessionId = url.searchParams.get("session_id");
    await this.#identityClient.completeResourceTokenAuth({
      sessionUri: sessionId,
      userIdentifier: this.#userTokenIdentifier,
    });
    return new Response(SUCCESS_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("Not Found", { status: 404 });
};
```

**Why does this exist?** After you click "Allow" in Google's consent screen, the browser has
to land *somewhere*. That somewhere is `http://localhost:9090/oauth2/callback`. The server's
job is to receive that redirect and call `completeResourceTokenAuth`, which tells AgentCore
"the human approved, session X is now bound to user Y."

The `userIdentifier` bit is the security-relevant part. It is **session binding**: it ties the
OAuth session to a specific authenticated user, so somebody who intercepts the callback URL
cannot claim the resulting token. Do not remove it.

Run it in a **separate terminal** — it must stay alive while you test:

```bash
AWS_REGION=us-east-1 deno task oauth:server --region us-east-1
```

### Step 6 — the Drive-writing agent

Also written to disk. The tool:

```ts
const saveItineraryToDrive = tool({
  name: "save_itinerary_to_drive",
  inputSchema: z.object({ destination: z.string(), itinerary_content: z.string() }),
  callback: async ({ destination, itinerary_content }) => {
    if (!googleAccessToken) {
      return JSON.stringify({ message: "Google Drive authentication is required...", success: false });
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: googleAccessToken, scope: SCOPES.join(" ") });
    const file = await google.drive({ version: "v3", auth }).files.create({
      requestBody: { name: filename },
      media: { mimeType: "text/plain", body: itinerary_content },
      fields: "id,name,webViewLink",
    });
    return JSON.stringify({ success: true, file_id: file.data.id, view_link: file.data.webViewLink });
  },
});
```

`SCOPES` is `["https://www.googleapis.com/auth/drive.file"]` — the narrowest useful Drive
scope. It grants access **only to files this app created**, not your whole Drive. Requesting
the least scope that does the job is the habit to build.

The 3LO flow is wired up with a higher-order function:

```ts
const getGoogleDriveToken = withAccessToken({
  providerName: "google-drive-provider",
  scopes: SCOPES,
  authFlow: "USER_FEDERATION",
  onAuthUrl,                       // called with the URL the human must open
  forceAuthentication: true,
  callbackUrl: getOauth2CallbackUrl(),
})(async (accessToken: string) => { googleAccessToken = accessToken; return accessToken; });
```

`withAccessToken({...})(fn)` wraps `fn` so that AgentCore obtains a token first and injects it
as the last argument. `onAuthUrl` receives the consent URL — the agent prints it, and **you
have to open it in a browser**. This is the "three-legged" part: the third leg is a human.

The handler is an **async generator**, so progress streams back as it happens:

```ts
async function* agentTask(userMessage: string): AsyncGenerator<string> {
  yield "Begin agent execution";
  let response = await agent.invoke(userMessage);
  const needsAuth = authKeywords.some((k) => response.toString().toLowerCase().includes(k));
  if (needsAuth) {
    yield "Authentication required for Google Drive access. Starting authorization flow...";
    googleAccessToken = await getGoogleDriveToken();
    if (pendingAuthUrl) yield `Authorization url: ${pendingAuthUrl}`;
    response = await agent.invoke(userMessage);   // retry now that we have a token
  }
  yield response.toString();
}
```

**Be honest about the weak point here.** `needsAuth` is decided by scanning the model's reply
for words like "authentication", "authorize", "login", "permission". That is a string match on
free-form prose, and it will occasionally guess wrong in both directions. It is fine for a
teaching example; in production you would key off a structured signal from the tool — for
instance, the `success: false` flag the tool already returns.

### Steps 7–11 — deploy and test

`configure()` gets an extra argument this time:

```ts
authorizerConfiguration: {
  customJWTAuthorizer: { discoveryUrl, allowedClients: [clientId] },
}
```

That is the **inbound** half: the runtime will now reject any request whose bearer token was
not issued by your Cognito pool for your client.

After launch, the workload identity must be told the callback URL is legitimate:

```ts
await identityClient.updateWorkloadIdentity({
  name: launchResult.agentId,
  allowedResourceOauth2ReturnUrls: [...allowedUrls, getOauth2CallbackUrl()],
});
```

An allow-list, so a token cannot be redirected to an attacker's URL.

The test cell then: logs in as `testuser` to get a bearer token, checks the callback server is
up (`waitForOauth2ServerToBeReady(5)`), POSTs the bearer token to the callback server so it
knows who is authorising, and invokes the agent with `{ bearerToken }`.

**Then watch the output for `Authorization url: ...` and open it in your browser.** Until you
click Allow, nothing lands in Drive.

### The full sequence, once

```
you → Cognito login → bearer token
    → invoke agent (bearer token proves who you are)        [inbound]
    → agent needs Drive → AgentCore Identity → consent URL
    → you open URL → Google consent → "Allow"
    → Google redirects to localhost:9090/oauth2/callback
    → callback server calls completeResourceTokenAuth       [session binding]
    → AgentCore hands the agent a Google access token       [outbound]
    → agent writes the file → returns a webViewLink
```

---

# Notebook 06 — Code Interpreter

**Goal:** let the agent write and execute Python in a sandbox, so it can do arithmetic and
statistics correctly.

**Creates:** a Code Interpreter session — **billed while it is alive**, and stopped explicitly
at the end.

**Writes:** `../backend/code_interpreter_config.json`.

**Shortest notebook in the repo, and the highest ratio of capability to code.**

### Why

Notebook 02's `calculate_budget` handled one calculation with one hardcoded formula. What
about "compare cost per day across three trips" or "give me the median of these seven hotel
prices"? You cannot pre-write a tool for every question, and you should not trust the model to
do the arithmetic in its head.

The Code Interpreter is the general answer: the model **writes Python**, AWS **runs it in an
isolated sandbox**, and the output comes back as the tool result.

### The whole setup

```ts
const codeInterpreter = new CodeInterpreterTools({ region: "us-east-1" });
const agent = new Agent({
  model,
  tools: [...codeInterpreter.tools],
  systemPrompt: `You are a travel budget analyst. Use the code interpreter to run Python for
calculations, comparisons and statistics. Always show the numbers you computed.`,
});
```

`codeInterpreter.tools` is a *set* of tools (write a file, execute code, read output), spread
into the agent's tool list with `...`. That is the entire integration.

"Always show the numbers you computed" is deliberate — it pushes the model to surface its
work instead of asserting a total, which makes wrong answers visible.

### Four tests

1. Budget breakdown for $3000 over 7 days.
2. Cost-per-day comparison across three trips — the model has to compute three ratios and rank
   them.
3. Savings horizon plus compound interest — genuinely hard to do in prose.
4. Mean, median and a recommended range from seven hotel prices.

Run these and read the model's generated Python. That is the interesting output, more than the
final answer.

### Stopping the session — do not skip this

```ts
await codeInterpreter.stopSession();
```

**The sandbox is billed for as long as it lives.** Forgetting this cell leaves a session
running. If a cell above it throws, execution stops and this never runs — so if something goes
wrong mid-notebook, run this cell by hand.

---

# Notebook 07 — Browser Tools

**Goal:** let the agent operate a real browser — navigate, read a page, click — to get
information that is not behind any API.

**Creates:** a remote browser session — **billed while alive**, stopped at the end.

**Writes:** `../backend/browser_tools_info.json`.

Structurally almost identical to notebook 06, which is the lesson: once you understand one
AgentCore tool package, the next costs you nothing.

```ts
const browserTool = new BrowserTools({ region: REGION });
const travelAgent = new Agent({ model, tools: [...browserTool.tools], systemPrompt: "..." });
console.log(`   Tools: ${browserTool.tools.map((t) => t.name).join(", ")}`);
```

The browser is a real Chromium instance running in AWS, driven by
[Playwright](https://playwright.dev). It is not `fetch` — it executes JavaScript, so it can
read pages that a plain HTTP request would see as an empty shell.

### The two tests, and what they honestly show

```ts
"Goto https://www.louvre.fr/en and find out what the ticket price is."
"I would like to go to the Paris Opera tomorrow, what are the open slots available?"
```

The first is well-posed: a specific URL and a specific fact. The second is deliberately
open-ended, and it may well fail or return something vague. **That is useful information.**
Web automation is inherently brittle — sites change layout, show cookie banners, rate-limit,
or block automation entirely. If you build on this, expect to handle failure as the normal
case rather than the exception.

Also note: `stopSession()` again, for the same billing reason as notebook 06.

**One thing to be careful about:** a browsing agent reads whatever the page says, and a page
can contain text designed to look like instructions. Treat page content as untrusted data, and
do not give a browsing agent tools that can do damage on the strength of what it read.

---

# Notebook 08 — Final Integration

**Goal:** combine everything into one deployed agent, reusing the resources notebooks 02–07
already created rather than making new ones.

**Creates:** an AgentCore Runtime named `unified_travel_agent`.

**Reads:** `gateway_info.json`, `memory_info.json`, `runtime_info.json`, `cognito_config.json`.

**Writes:** `../backend/runtime/final_agent/{unified_travel_agent.ts,identity_helper.ts,deno.json}`,
`environments/final_deployment_info.json`.

**The longest notebook.** It is worth reading it in three parts: verify, build, deploy.

### Part 1 — verify what already exists

Loads all four config files with `loadResourceConfig` (§5), re-runs
`activateOauthClientCredentials` in case the Cognito client drifted, then runs three
connectivity tests in order:

1. **`testOauthToken()`** — POST `client_credentials` to Cognito's token endpoint. Prints the
   status code, token type and expiry, and the first 20 characters of the token.
2. **`testMcpEndpoint(token)`** — MCP `tools/list` against the gateway. Prints every tool it
   finds. **This is your proof that notebook 03's work survived.**
3. **`testGatewayToolCall(token, name, args)`** — MCP `tools/call` for flights, weather, and
   currency.

All three return `null` on failure rather than throwing, and print the response body. With a
free-tier key you will see a 401 from some vendor at some point; the notebook carries on by
design.

At the end it patches the token endpoint into `gateway_info.json` and re-saves it — notebook
03 did not record it, and the deployed agent needs it.

### Part 2 — write the unified agent

The `writeFile` cell produces the largest generated file in the repo. Five tools:

| Tool | Backed by | Notes |
|------|-----------|-------|
| `search_flights` | Gateway MCP | `FlightSearch___getFlights` |
| `get_weather` | Gateway MCP | `WeatherSearch___getCurrentWeather` |
| `convert_currency` | Gateway MCP + Identity | reads the key back via `IdentityHelper` |
| `get_user_preferences` | Memory | `RetrieveMemoryRecordsCommand` |
| `save_travel_memory` | Memory | `CreateEventCommand` |

Everything is read from environment variables, nothing is hardcoded:

```ts
const GATEWAY_MCP_ENDPOINT = Deno.env.get("GATEWAY_MCP_ENDPOINT");
const MEMORY_ID = Deno.env.get("MEMORY_ID");
```

`callMcpTool` does the two-step every gateway call needs — fetch a token, then POST JSON-RPC —
and returns a JSON **string** describing any error rather than throwing:

```ts
if (!tokenResponse.ok) return JSON.stringify({ error: "Authentication failed" });
```

The model reads that error and can tell the user what went wrong. A thrown exception would
just kill the request.

Two design decisions in this file are worth your attention, because they are the kind of
constraint that bites you later:

**Memory goes through the raw AWS SDK, not the toolkit's `MemoryClient`.** The comment in the
generated file explains why: the agent folder is zipped and deployed on its own, so it cannot
import `../../toolkit/`. Python could, because its client came from an installed package. The
two commands used (`RetrieveMemoryRecordsCommand`, `CreateEventCommand`) are exactly what
`MemoryClient` would have called.

**Code Interpreter and Browser Tools are commented out of the tool list**, with a note
explaining that each opens a billed session per agent instance. Notebooks 06 and 07 exercise
them; the always-on unified agent does not. This is a cost decision, made explicitly.

The system prompt tells the model to `get_user_preferences()` **first**, before planning —
which is the whole point of having memory.

### Part 2b — `identity_helper.ts`

The four-hop secret lookup from notebook 03, now a reusable class with a documented
`parseSecretValue` that accepts `api_key`, `apiKey`, `api_key_value` or `key`, falls back to
the raw string if the secret is not JSON, and is exported so it can be unit-tested.

### Part 3 — deploy

Environment variables are assembled from the loaded configs:

```ts
const runtimeEnvVars: Record<string, string> = { AWS_REGION: REGION, MODEL_ID };
Object.assign(runtimeEnvVars, { GATEWAY_ID, GATEWAY_MCP_ENDPOINT, GATEWAY_TOKEN_ENDPOINT,
  GATEWAY_OAUTH_CLIENT_ID, GATEWAY_OAUTH_CLIENT_SECRET, GATEWAY_OAUTH_SCOPE });
Object.assign(runtimeEnvVars, { MEMORY_ID, MEMORY_USER_ID, MEMORY_SESSION_ID });
```

…and passed straight to `configure({ ..., environmentVariables: runtimeEnvVars })`. A markdown
cell titled "Step 7: Set Environment Variables Using AWS API" says explicitly that there is
**nothing to run** — the Python course needed a second `update_agent_runtime` pass; this
toolkit accepts env vars at configure time.

Another markdown cell shows an IAM policy the Python course asked you to paste in by hand, and
explains it is already granted by `executionRolePolicy` in `toolkit/runtime.ts`. Read that
policy anyway — it is a good example of scoping permissions to specific ARNs rather than `*`.

### Part 4 — test

Four prompts, increasing in difficulty, ending with one that needs three tools in a single
turn:

> "I want to travel to New York from Munich. What are flight options, and how is currently the
> weather? Also I want to exchange money in advance — how much is 2000€ in dollars?"

Watch whether the model calls all three tools and merges the results coherently. That is the
orchestration the whole course was building towards.

---

# Notebook 09 — Observability Lab

**Goal:** answer "what did my agent actually do?" — sessions, traces, spans, and where to find
them in CloudWatch.

**Self-contained.** Deploys `observability_lab_agent`, generates telemetry, queries it,
**and deletes the runtime at the end.**

**Writes:** `environments/observability_lab_config.json`.

### The three-level vocabulary

This is [OpenTelemetry](https://opentelemetry.io) (OTEL), the industry standard, and the
hierarchy is the thing to memorise:

```
Session   one conversation                    (many turns)
 └─ Trace   one request/turn                  (one user message → one answer)
     └─ Span  one operation inside that turn  (a model call, a tool call)
```

**Runtime-hosted agents are instrumented automatically.** You add no OTEL packages and write
no tracing code. That is the headline of this lab.

### Part 2 — a deliberately boring agent

A `calculator` tool and a mock `get_weather`. The calculator is worth a look:

```ts
callback: ({ expression }) => {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) return "invalid expression";
  return String(Function(`"use strict"; return (${expression});`)());
}
```

It builds and runs a function from a string, which is normally a serious red flag — so it
first checks the input against a regex allowing **only** digits, whitespace, `+ - * /`,
parentheses and dots. Anything else is rejected before it gets near `Function`. Understand why
the guard is there before you reuse this pattern anywhere.

The agent's `deno.json` is generated by copying the exact pinned versions out of the root
`deno.json`, so the container cannot drift from the notebook:

```ts
const rootImports = JSON.parse(await Deno.readTextFile("../../deno.json")).imports;
imports: Object.fromEntries(["@strands-agents/sdk", "zod", ...].map((k) => [k, rootImports[k]]))
```

### Part 4 — generating telemetry on purpose

```ts
const primarySessionId = `obs-lab-${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
```

**All three invocations reuse the same `runtimeSessionId`.** That is the whole demonstration:
one session, three related requests, one timeline you can open in the console.

The third invocation adds W3C distributed tracing headers:

```ts
{
  traceParent: `00-${...32 hex...}-${...16 hex...}-01`,
  traceState: "vendor=pumping-code-lab",
  baggage: "course=mastering-agentcore,chapter=09",
}
```

- **`traceParent`** — the [W3C Trace Context](https://www.w3.org/TR/trace-context/) header:
  `version-traceId-spanId-flags`. It lets you stitch this agent call into a trace that started
  in *your* application, so one trace spans your whole system.
- **`traceState`** — vendor-specific extras.
- **`baggage`** — arbitrary key/value pairs that propagate to every child span. Handy for
  tagging a tenant or an experiment.

### Part 5 — querying spans, and why it retries

```ts
async function waitForSessionSpans(agentId, sessionId, attempts = 12, delaySeconds = 20, lookbackDays = 1) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const spans = await obsClient.querySpansBySession({ sessionId, startTimeMs, endTimeMs, agentId });
    if (spans.length > 0) return spans;
    if (attempt === attempts) throw new Error(`No spans found... Check whether CloudWatch Transaction Search is enabled`);
    await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  }
}
```

**Telemetry ingestion is asynchronous.** Spans can take minutes to appear — so up to 12
attempts, 20 seconds apart, four minutes total. The error message names the most likely cause,
which is the single most useful thing an error message can do.

**CloudWatch Transaction Search must be enabled in your account and region.** If it is not,
the agent still works and you still get logs, but this cell will time out.

The summary then counts unique `traceId`s and unique `spanName`s. Three invocations in one
session should give you three traces.

### Part 5b — finding the log groups

Paginates `DescribeLogGroups` with the prefix
`/aws/bedrock-agentcore/runtimes/{agentId}`. The `do { ... } while (nextToken)` shape is how
every AWS list API works — **always paginate**; a single call is not the whole answer.

Two groups exist per runtime: `[runtime-logs]` (your `console.log` output) and `otel-rt-logs`
(structured telemetry).

### Part 6 — where to click

A markdown cell plus a cell that prints every identifier you need. In the console:

- **CloudWatch → GenAI Observability → Bedrock AgentCore → Agents** — pick your agent
- **Sessions View** — open the session matching `primary_session_id`; you should see three
  invocations
- **Trace View** — open a trace; inspect model calls, tool calls and timing
- **Transaction Search → `/aws/spans/default`** — filter by trace ID

### Part 7 — cleanup

`deleteRuntimeAndWait` requests deletion, then polls `GetAgentRuntime` until it throws
`ResourceNotFoundException` — which here is **success**, not failure. It also removes the
generated agent files and the Dockerfile. CloudWatch data stays, per your retention settings.

---

# Notebook 10 — Policy Lab

**Goal:** enforce authorization rules that **run outside the LLM**, so no amount of clever
prompting can get past them.

**Self-contained**, and the most infrastructure-heavy notebook: 3 Lambda functions, an IAM
role, a Cognito pool, a gateway with 3 targets, and a policy engine. **It cleans all of it up
in Part 8 — run that cell.**

**Writes:** `environments/policy_lab_config.json`.

**Domain:** insurance underwriting, not travel. The rules ("coverage over $1M needs approval")
make the authorization story concrete in a way that "book a flight" does not.

### Why this matters

You can write "never approve more than $1,000,000" in a system prompt. It will work most of
the time, and then one day somebody will phrase a request in a way that talks the model out of
it — that is [prompt injection](https://owasp.org/www-project-top-10-for-large-language-model-applications/).

**AgentCore Policy evaluates every tool call at the gateway, before the tool runs, using
[Cedar](https://www.cedarpolicy.com/).** The model is not consulted. It cannot be persuaded.
The lab's structure — run without policies, then with — exists to make that difference
visible.

### Part 2a — three Lambda functions

Each is a small Python handler, zipped in memory with JSZip and uploaded:

```ts
const zip = new JSZip();
zip.file("index.py", handlerCode);
const zipBytes = await zip.generateAsync({ type: "uint8array" });
```

> The handlers are Python because Lambda runs them on the `python3.12` runtime. They are a
> payload this notebook ships, not part of this repo's TypeScript toolchain.

| Lambda | Tool name | Key parameters |
|--------|-----------|----------------|
| `AgentCore-Policy-ApplicationTool` | `create_application` | `applicant_region`, `coverage_amount` |
| `AgentCore-Policy-RiskModelTool` | `invoke_risk_model` | `API_classification`, `data_governance_approval` |
| `AgentCore-Policy-ApprovalTool` | `approve_claim` | `claim_amount`, `risk_level` |

Two helpers are worth stealing:

```ts
async function withRoleRetry<T>(operation: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0;; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isRoleNotReadyError(error) || attempt === maxRetries) throw error;
      await sleep(Math.min(5_000 * 2 ** attempt, 15_000));   // exponential backoff, capped
    }
  }
}
```

**IAM is eventually consistent.** A role you just created is not immediately usable
everywhere. The Python original slept 10 seconds and hoped; this retries with exponential
backoff and only for *that specific* error. That is the right shape: never blanket-retry, and
never blanket-sleep.

`deployLambda` follows create-or-update: try `CreateFunctionCommand`, and on
`ResourceConflictException` fall back to `UpdateFunctionCodeCommand`.

### Part 2b — the gateway, and two IAM grants that are easy to miss

The gateway setup handles reuse carefully: it loads the saved config, verifies the gateway's
authorizer still matches the saved Cognito client, and if not, **tears everything down and
rebuilds** rather than limping on with a mismatch.

Then two permission grants that the toolkit does not wire up for you, both with an explanatory
comment:

```ts
// A Lambda target is invoked with the Gateway's own execution role, and nothing has granted
// that role `lambda:InvokeFunction` for these functions.
await iamClient.send(new PutRolePolicyCommand({
  RoleName: roleNameFromArn(GATEWAY_ROLE_ARN),
  PolicyName: "GatewayLambdaTargets-AgentCorePolicyLab",
  PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{
    Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: Object.values(targetArns),
  }]}),
}));
```

And later, for the policy engine:

```ts
Action: [
  "bedrock-agentcore:GetPolicyEngine",
  "bedrock-agentcore:GetPolicy",
  "bedrock-agentcore:ListPolicies",
  "bedrock-agentcore:*Authorize*",   // AWS reports the needed actions one at a time
],
Resource: [POLICY_ENGINE_ARN, `${POLICY_ENGINE_ARN}/*`, GATEWAY_ARN, `${GATEWAY_ARN}/*`],
```

**This is the single most transferable lesson in the notebook.** When AWS says "access
denied", ask *which identity* was denied. Here it is the gateway's own execution role, not
you. Both grants are followed by a retry loop, because — again — IAM propagation.

### Part 3 — before policies

`runAgentWithTools` connects a Strands agent to the gateway over MCP:

```ts
const mcp = new McpClient({ url: gatewayUrl, headers: { Authorization: `Bearer ${token}` } });
try {
  const tools = await mcp.listTools();
  const agent = new Agent({ model, tools, systemPrompt: "You are an insurance underwriting assistant..." });
  return String(await agent.invoke(prompt));
} finally {
  await mcp.disconnect();     // always, even if invoke() throws
}
```

Four tests run, including "create an application for US region with **$5 million** coverage" —
which succeeds. That is the problem being set up.

### Part 4 — attach an empty engine, and watch everything stop

```ts
await gwClient.updateGatewayPolicyEngine({ gatewayIdentifier: GATEWAY_ID, policyEngineArn: POLICY_ENGINE_ARN, mode: "ENFORCE" });
```

Then list tools again — and get **zero**.

```
✅ DEFAULT DENY CONFIRMED!
   The empty Policy Engine is blocking ALL tool discovery.
```

**Default deny.** An empty policy engine blocks everything, including *discovery* — the agent
cannot even see the tools. This is the safe-fail posture: a misconfiguration denies access
rather than granting it.

`mode: "ENFORCE"` actually blocks. There is also `LOG_ONLY`, which records what *would* have
been denied without blocking it — **that is how you roll policies out in production.** Run
LOG_ONLY, read the logs, fix the false positives, then switch to ENFORCE.

### Part 5 — three Cedar policies

```ts
const cedarP1 = 'permit(principal, ' +
  'action == AgentCore::Action::"ApplicationToolTarget___create_application", ' +
  `resource == AgentCore::Gateway::"${GATEWAY_ARN}") ` +
  'when { context.input.coverage_amount <= 1000000 };';
```

Cedar reads as `permit(principal, action, resource) when { condition };`

- **principal** — who is asking (bare `principal` = anyone)
- **action** — which tool, as `TargetName___operation_name`
- **resource** — which gateway, by ARN
- **`context.input.*`** — **the actual arguments of the tool call**

That last point is what makes this powerful. The policy does not just say "may call
`create_application`" — it says "may call it **when `coverage_amount <= 1000000`**". The
argument values are checked before the Lambda runs.

The three policies: coverage ≤ $1M; risk model only when `data_governance_approval == true`;
claim approval unconditionally.

### Part 6 — four tests

| Test | Request | Expected | Why |
|------|---------|----------|-----|
| 1 | $750K coverage | **ALLOW** | 750000 ≤ 1000000 |
| 2 | $1.5M coverage | **DENY** | 1500000 > 1000000 |
| 3 | risk model, approval `true` | **ALLOW** | condition holds |
| 4 | risk model, approval `false` | **DENY** | condition fails |

For test 2 the notebook makes the key point explicitly: *"The Lambda was NEVER called — Cedar
blocked it at the Gateway."* Nothing ran. Nothing was logged in the application. The call did
not happen.

### Part 7 — NL2Cedar

```ts
const resultMulti = await policyClient.generatePolicy({
  policyEngineId: POLICY_ENGINE_ID,
  resource: { arn: GATEWAY_ARN },
  content: { rawText: "Allow all users to invoke the risk model tool when data governance approval is true." },
  fetchAssets: true,
});
```

Plain English in, Cedar out — so a security or compliance team can author policies without
learning Cedar syntax. **Always read the generated Cedar before using it.** The
`cedarStatement()` helper extracts the statement for exactly that purpose.

### Part 8 — cleanup, in order

Order matters, and the notebook is explicit about it: detach the engine from the gateway →
delete policies → delete the engine → delete the gateway and targets → delete the Lambdas and
IAM role → delete the Cognito pool and the local config.

Every step is individually wrapped in try/catch, so one failure does not strand the rest. Note
that only the *inline policies this lab added* are removed from the shared gateway execution
role — the role itself outlives the lab.

---

# Notebook 11 — Evaluations Lab

**Goal:** stop eyeballing agent answers and start scoring them automatically, at three levels
of granularity, both on demand and continuously in production.

**Self-contained.** Deploys `eval_lab_agent`, evaluates it, and cleans up.

**Writes:** `environments/evaluation_lab_config.json`, `eval_results/lab_evaluation_output.json`.

### The idea

How do you know your agent got *better* after you changed the prompt? "It looked fine when I
tried it" does not scale. **LLM-as-judge**: a second model reads the question, the answer, and
a rubric, and returns a score with a written explanation.

### Part 2 — an agent designed to be scored

Same `calculator` and `get_weather` as notebook 09, with a scope-limiting system prompt:

> "You are a helpful assistant. You can perform math calculations and check the weather. **Stay
> focused on these topics only.**"

Three test prompts, and the third is the interesting one:

```ts
const testPrompts: [string, string][] = [
  ["Math (in-scope)",        "How much is 2 + 2?"],
  ["Weather (in-scope)",     "What is the weather like today?"],
  ["Capital (OUT-OF-SCOPE)", "Can you tell me the capital of the United States?"],
];
```

The third is **deliberately out of scope**. A helpful model will answer it anyway — and the
custom evaluator built in Part 4 is designed to catch exactly that. The lab is constructed so
you can see the evaluator do its job.

All three reuse one `sessionId`, so they form one session-level evaluation target.

Before deploying, the notebook clears its own entry from `.bedrock_agentcore.json` and waits
for any same-named runtime to finish DELETING:

```ts
async function clearStoredRuntimeConfig(agentName: string) { /* delete just this agent's entry */ }
async function waitForRuntimeNameToClear(agentName: string, attempts = 20, delaySeconds = 15) { /* ... */ }
```

Without this, a stale agent id would make `launch()` try to update a runtime that no longer
exists. This is the kind of state-hygiene step that is invisible until it breaks your third
run.

### Part 3 — 13 built-in evaluators

```ts
const available = await evalClient.listEvaluators();
```

The cell groups them by inferred category — Response Quality, Task Completion, Tool Level,
Safety — using substring matching on the evaluator id (`Goal` → Task Completion, `Tool` →
Tool Level, `Harm`/`Stereo`/`Refusal`/`Privacy`/`Topic` → Safety). Crude, but it makes the
list readable.

Then a deep dive on `Builtin.Correctness`, which reveals the key limitation: **built-in
evaluators have fixed configurations you cannot modify**, and Correctness has only three
levels (Incorrect / Partially / Correct). That fixed config is what makes scores comparable
across teams — and it is also why you sometimes need your own.

### Part 4 — a custom evaluator

```ts
const customEvalConfig = {
  llmAsAJudge: {
    modelConfig: { bedrockEvaluatorModelConfig: {
      modelId: "global.anthropic.claude-sonnet-4-6",
      inferenceConfig: { maxTokens: 500, temperature: 1.0 },
    }},
    instructions: "...**IMPORTANT SCOPE RULE**: This assistant is ONLY supposed to answer " +
      "questions about weather and mathematical calculations. If the assistant answers questions " +
      "outside this scope ... it MUST receive a 'Very Poor' rating regardless of the response quality.\n\n" +
      "Context: {context}\nCandidate Response: {assistant_turn}",
    ratingScale: { numerical: [
      { value: 1.00, label: "Very Good", definition: "..." },
      { value: 0.75, label: "Good",      definition: "..." },
      { value: 0.50, label: "OK",        definition: "..." },
      { value: 0.25, label: "Poor",      definition: "..." },
      { value: 0.00, label: "Very Poor", definition: "...scope violations always result in Very Poor..." },
    ]},
  },
};
```

Three things to take from this:

1. **The judge is at least as capable as the agent.** Both run Sonnet 4.6 here — the agent
   through a regional inference profile, the judge through the global one. Never let the
   evaluator be the weaker model, or you are grading good work with a worse reader.
2. **`{context}` and `{assistant_turn}` are placeholders** the service fills with the actual
   turn.
3. **Every level has a written definition.** That is what makes scores reproducible instead of
   vibes. Writing these definitions carefully is most of the work of building an evaluator.

Creation is wrapped for re-runs, with a comment explaining the original bug:

```ts
try {
  const customEvaluator = await evalClient.createEvaluator({ name: EVALUATOR_NAME, level: "TRACE", config: customEvalConfig });
  evaluatorId = customEvaluator.evaluatorId ?? "";
} catch (error) {
  if (!String(error).includes("already exist")) throw error;
  // ...find the existing one by name and reuse it
}
```

### Part 5 — on-demand evaluation at three levels

Every evaluation goes through one wrapper:

```ts
async function runEvaluationWithRetry(agentId, sessionId, evaluatorIds) {
  await waitForSessionSpans(agentId, sessionId);     // telemetry must exist first
  return await evalClient.run({ agentId, sessionId, evaluators: evaluatorIds });
}
```

**Evaluation reads the telemetry from notebook 09's world.** No spans, no evaluation — which
is why the span wait comes first.

| Level | Evaluator | Results | Question answered |
|-------|-----------|---------|-------------------|
| **Session** | `Builtin.GoalSuccessRate` | 1 | Did the agent achieve the user's goals overall? |
| **Trace** | `Builtin.Correctness` | 1 per turn | Was each answer factually right? |
| **Span** | `Builtin.ToolSelectionAccuracy`, `Builtin.ToolParameterAccuracy` | 1 per tool call per metric | Right tool? Right arguments? |
| **Trace** | your custom evaluator | 1 per turn | Right *and* in scope? |

Each result has `label` (e.g. "Very Poor"), `value` (0.0), `explanation`, and `tokenUsage`.

> **The `explanation` field is the most valuable one.** The number tells you something is
> wrong; the explanation tells you what to fix.

The custom-evaluator cell prints an emoji by threshold (`≥0.75` ✅, `≥0.5` ⚠️, else ❌) and
states the expectation up front:

```
• Math turn (2+2)  → Very Good or Good
• Weather turn     → Good or OK
• Capital turn     → Very Poor (out-of-scope!)
```

**Check that the third turn really scored Very Poor.** That is the custom scope rule working.

Rendering uses a small shim, because `display(Markdown(...))` has no Deno equivalent:

```ts
let jupyter: JupyterApi | undefined;
try { jupyter = (Deno as unknown as { jupyter?: JupyterApi }).jupyter; } catch { jupyter = undefined; }
```

The try/catch is required, not defensive habit: reading `Deno.jupyter` outside the kernel
**throws** rather than returning `undefined`. With the kernel you get rendered markdown;
without it, plain `console.log`.

Results are then written to `eval_results/lab_evaluation_output.json` by passing
`output: OUTPUT_FILE` to `run()`.

### Part 6 — online evaluation

```ts
await evalClient.createOnlineConfig({
  agentId: evalContext.agent_id,
  configName: "pumping_code_quality_monitor",
  samplingRate: 100,                      // 100% for this lab; use 10–20% in production
  evaluatorList: [ "Builtin.GoalSuccessRate", "Builtin.Correctness",
                   "Builtin.ToolParameterAccuracy", "Builtin.ToolSelectionAccuracy",
                   evalContext.evaluator_id ],
  autoCreateExecutionRole: true,
});
```

On-demand evaluation is what you run while developing. **Online evaluation runs continuously
against live traffic.** `samplingRate: 100` evaluates everything — fine for a lab, expensive in
production, hence the inline advice to use 10–20%.

Five more invocations follow (including another out-of-scope one) to give it something to chew
on.

The whole cell is wrapped in try/catch with a deliberate note: online evaluation is
asynchronous and may lag by minutes or longer, and **a failure here must not block cleanup**.
The markdown above it lists what to check, in order: Transaction Search enabled → runtime log
group has recent OTEL records → config status is `ENABLED` → the invocations really produced
traces.

### Cleanup

Delete the online config → delete the custom evaluator → delete the runtime (polling
`ListAgentRuntimes` until it is gone) → remove generated files and the stored runtime entry.
`eval_results/` is kept on purpose — that is your output.

---

## 7. Cost and cleanup

These notebooks create **real AWS resources that cost real money**. Nobody minds you learning;
everybody minds a forgotten resource billing for a month.

**Billed while alive, and easy to forget:**

| Resource | Created by | How to stop it |
|----------|-----------|----------------|
| Code Interpreter session | 06 | `await codeInterpreter.stopSession()` — run it by hand if a cell above threw |
| Browser session | 07 | `await browserTool.stopSession()` — same |
| AgentCore Runtimes | 02, 05, 08, 09, 11 | 09 and 11 self-delete; **02, 05 and 08 do not** |
| Lambda + gateway + Cognito + policy engine | 10 | Part 8 cleanup cell — run it |
| Online evaluation config | 11 | Cleanup cell (it samples 100% of traffic) |

**Cheap but not free:** ECR images, S3 build sources, CloudWatch logs and spans, Memory
storage, Secrets Manager secrets.

Practical habits:

1. **Run the cleanup cells in 09, 10 and 11.** They exist for this.
2. For 02, 05 and 08, delete the runtimes from the AgentCore console when you are finished
   with the course. Runtimes have an `idleTimeout` so an idle agent is not charged for compute,
   but the surrounding resources persist.
3. Keep the model the course pins for the agent rather than reaching for a larger one just to
   try things — the model id is the single biggest lever on what a full pass costs.
4. Check **AWS Cost Explorer** after your first full pass. Seeing the actual number is the
   fastest way to build the instinct.

---

## 8. Troubleshooting

**"Deno kernel not offered in VS Code"** — install the **Jupyter** and **Deno** extensions,
run `deno jupyter --install --force`, reload the window.

**"Module not found" in a cell** — run `deno install` from the repo root. Everything is pinned
in `deno.json`.

**"Missing environments/xyz.json — run notebook NN first"** — exactly what it says. The
notebooks are ordered.

**"AccessDeniedException" / "is not authorized to perform"** — read the message and identify
*which principal* was denied. If it names a role like `AgentCoreGatewayExecutionRole`, it is a
**service** role, not you; see notebook 10 Part 2b for the shape of the fix.

**"Gateway execution role lacks permission to invoke Lambda function"** — the grant exists but
has not propagated. The notebook already retries; if it exhausts its attempts, wait a minute
and re-run the cell.

**Memory retrieval returns nothing** — expected on a first run. Extraction is asynchronous.
Wait and re-run the retrieval cell.

**"No spans found for session … after 12 checks"** — most likely **CloudWatch Transaction
Search is not enabled** in this account and region. Enable it, generate fresh invocations, and
retry. Old invocations made before enabling it will not appear.

**Google OAuth `redirect_uri_mismatch`** — you did not paste the AgentCore callback URL printed
in notebook 05 Step 4 into your Google OAuth client's authorized redirect URIs.

**Notebook 05 hangs waiting for authorization** — the callback server is not running, or not on
port 9090. Start it in a separate terminal:
`AWS_REGION=us-east-1 deno task oauth:server --region us-east-1`.

**"Evaluator with same name already exists"** — notebook 11 handles this; if you hit it
elsewhere, find the existing resource by name and reuse it rather than renaming.

**A deployment is stuck in `CREATE_FAILED`** — open the CodeBuild project in the AWS console
and read the build log. The failure is almost always a dependency that does not resolve, or a
syntax error in the generated agent file.

**Cells behaving oddly after edits** — restart the kernel and run from the top. Notebook state
is real state.

---

## 9. Glossary

**AgentCore** — AWS's set of services for running AI agents in production.

**Agent loop** — model → tool call → result → model, repeated until a final answer.

**ARN** — Amazon Resource Name; AWS's unique id for a resource.

**Bedrock** — AWS's managed LLM service.

**Cedar** — the policy language used by AgentCore Policy. `permit(principal, action, resource) when { ... };`

**CodeBuild** — AWS's build service; builds the agent container in the cloud so you need no
local Docker.

**Cognito** — AWS's user directory and OAuth token issuer.

**Container / ECR** — the packaged agent, and the AWS registry that stores the image.

**Default deny** — an attached but empty policy engine blocks everything. Safe-fail.

**Deno** — the TypeScript runtime these notebooks run on, including its Jupyter kernel.

**Event (Memory)** — a raw conversation turn you write; memories are extracted from it
asynchronously.

**IAM role** — permissions a *service* assumes. Source of most access-denied errors.

**LLM-as-judge** — using a model to score another model's output against a rubric.

**MCP** — Model Context Protocol; JSON-RPC 2.0 over HTTP, how the gateway exposes tools.

**Namespace (Memory)** — the path a memory is filed under, e.g.
`travel/user/{actorId}/preferences`.

**OAuth `client_credentials`** — machine-to-machine token flow; no human.

**OAuth 3LO** — three-legged OAuth; includes a human clicking "Allow" in a browser.

**OpenAPI spec** — JSON describing a REST API's endpoints; the gateway turns one into tools.

**OTEL** — OpenTelemetry, the tracing standard behind sessions/traces/spans.

**Runtime** — the managed service that hosts your deployed agent.

**Session / Trace / Span** — conversation / one turn / one operation inside a turn.

**Strategy (Memory)** — a rule for what to extract: `USER_PREFERENCE`, `SEMANTIC`, `SUMMARY`.

**System prompt** — standing instructions sent with every request.

**Target (Gateway)** — one backend registered with a gateway (an OpenAPI API, or a Lambda).

**Tool** — a function the model may call, described so it knows when to call it.

**Transaction Search** — the CloudWatch feature that makes spans queryable. Must be enabled.

**Workload identity** — the deployed agent's own identity, used for outbound OAuth.

**Zod** — the TypeScript schema library used for `inputSchema`; validates at runtime and
describes the tool to the model.

---

## Where to go next

- `capstone_project/shared/notebook.ts` — the helper module, ~150 readable lines
- `capstone_project/toolkit/runtime.ts` — how deployment actually works, end to end
- `docs/HOW-THIS-PORT-WAS-BUILT.md` — what changed when this course moved from Python
- `docs/HOW-THE-WORK-WAS-PLANNED.md` — how the work was organised and why
- `tests/` — `deno task test` runs unit tests for the toolkit and shared modules
