# How this TypeScript port was built

*A walkthrough for someone new to the project. No prior knowledge of this repo assumed.*

*Its companion, [HOW-THE-WORK-WAS-PLANNED.md](HOW-THE-WORK-WAS-PLANNED.md), covers how the work was
organised and why each decision was made.*

---

## 1. What is this repository?

It is the code for a **course** that teaches you how to build AI agents on **Amazon Bedrock
AgentCore**. You learn by building one thing across eleven Jupyter notebooks: an **AI Travel
Companion** that plans trips, remembers your preferences, looks up flights and weather, and saves
itineraries to Google Drive.

"AgentCore" is a set of AWS building blocks for agents. The course covers seven of them:

| Building block | What it does, in plain terms |
| --- | --- |
| **Runtime** | Hosts your agent in AWS so it can be called over the internet |
| **Gateway** | Turns ordinary REST APIs (weather, flights, currency) into tools an agent can call |
| **Memory** | Remembers things about a user between conversations |
| **Identity** | Handles "log in with Google" style flows on the agent's behalf |
| **Code Interpreter** | A sandbox where the agent can run code to do real calculations |
| **Browser** | A real web browser in AWS the agent can drive |
| **Observability / Evaluations** | Traces what the agent did, and scores how well it did it |

The course originally ran on **Python**.

## 2. What were we asked to do?

> "I have this in Python and want to update to TypeScript, and **only the programming language
> should change** — everything else stays as it is: virtual environment, dependencies, and so on."

That one sentence contains a trap, and spotting it was the first real task.

**The trap:** TypeScript cannot use a Python virtual environment, and it cannot install from
`pyproject.toml`. So "keep the venv" cannot mean literally keeping it. After a short conversation
it became: *keep the same shape, built from TypeScript's own parts.*

| Python thing | Its TypeScript counterpart here | Same role? |
| --- | --- | --- |
| `pyproject.toml` | `deno.json` | ✅ |
| `uv.lock` | `deno.lock` | ✅ |
| `.venv/` folder | Deno's own dependency cache | ✅ |
| `requirements.txt` per agent | `deno.json` per agent folder | ✅ |
| `.python-version` | `.deno-version` | ✅ |
| `setup.sh` | `setup.sh` (same script, Deno commands) | ✅ |

Every folder, file role and workflow survived. Only the language changed.

## 3. Why Deno, and what is it?

**Deno** is a runtime for JavaScript and TypeScript — the thing that actually runs the code, the
way `python` runs Python. We chose it (the user chose it, after seeing the options) for two
reasons:

1. **It runs TypeScript directly.** No separate compile step.
2. **It has a built-in Jupyter kernel.** This is the big one. The course is eleven notebooks, and
   notebooks need a "kernel" — the engine that executes each cell. Deno ships one, so the
   notebooks run TypeScript with **no Python installed anywhere**.

A learner now needs: Deno, VS Code, and two VS Code extensions (Jupyter and Deno). That's it.

## 4. How we worked: a map, not a to-do list

A rewrite of an unfamiliar codebase is mostly *unknowns*. You do not know whether the libraries
exist, whether they work on your runtime, or what will break when you deploy. Writing a linear
plan first would have meant inventing answers.

So instead we kept a **map** — a living document plus a folder of **tickets**, one question each.
It lives in `.scratch/typescript-port/`, and it is in the repository so anyone can read the whole
history of decisions.

The rules were simple:

- A ticket holds **one question**, small enough for one work session.
- A ticket that depends on another is marked **blocked** until that one is answered.
- Things we could see coming but could not yet describe precisely went in a **"Not yet specified"**
  section — deliberately vague, sharpened later.
- Every answer was written back into its ticket, with the evidence.

By the end: **29 tickets**, all but two resolved, and **47 commits**.

## 5. Step by step, in the order it happened

### Step 1 — Name the destination (before writing any code)

We agreed exactly what "done" looks like: *every Python file, notebook, test and script replaced by
a TypeScript equivalent that actually runs against AWS, with the Python toolchain deleted.*

That last clause mattered. "Runs against AWS" — not "compiles". It is the reason this port found
bugs that had been sitting in the course unnoticed.

### Step 2 — Four research questions, answered in parallel

Before choosing anything, we needed facts. Four investigations ran at once:

1. **Does an AgentCore SDK exist for TypeScript?** Yes — `bedrock-agentcore` on npm. But the
   *starter toolkit* the notebooks lean on (the thing that deploys agents, creates gateways, runs
   evaluations) has **no TypeScript version at all**.
2. **Does the Strands agent framework exist for TypeScript?** Yes and it is stable, but tools are
   declared differently, and there is no built-in `calculator`.
3. **Can Jupyter notebooks run TypeScript without Python?** Yes, via Deno's kernel in VS Code.
4. **Can a Deno agent be deployed to AgentCore Runtime?** Yes, as a container — but *observability
   looked impossible*, and the course has a whole lab about observability.

That fourth answer was the scary one.

### Step 3 — The observability spike (the riskiest unknown, tackled early)

**The problem:** AWS ships a library that automatically sends traces from your agent to CloudWatch.
It exists for Python and for Node. **Not for Deno.** Without traces, two of the eleven notebooks
cannot work.

Rather than guess, we built a throwaway agent and tested three approaches against real AWS:

| Approach | Result |
| --- | --- |
| Deno's built-in tracing | ❌ Nothing arrives — AWS gives the container no address to send to |
| AWS's Node library | ❌ Cannot even be imported under Deno |
| **Write our own exporter** | ✅ **Works** |

The third one won. It is about 100 lines: take the trace data, sign it with AWS credentials
(AWS rejects unsigned requests), and POST it to X-Ray's endpoint. We proved the traces landed in
CloudWatch, with session IDs attached, before committing to Deno for the whole project.

**Why this mattered:** had it failed, the deployed agents would have had to run on Node while
everything else ran on Deno — two runtimes in one repo. Testing first avoided that.

### Step 4 — The toolchain skeleton

With the risk retired, we built the foundation: `deno.json` with every dependency pinned to an
**exact** version, `deno.lock`, `.deno-version`, and `setup.sh`.

Why exact versions and not "latest compatible"? Because several packages are pre-1.0, and Deno is
not officially supported by any of them. A course that breaks when a dependency updates is a bad
course. This mirrors what `uv.lock` was doing before.

### Step 5 — Rebuilding the missing toolkit

This was the largest piece of new code: **`capstone_project/toolkit/`**, about 6,800 lines
including tests.

Remember research finding #1 — the Python starter toolkit has no TypeScript version. The notebooks
call it constantly. So we rebuilt the parts the course uses, on top of the official AWS SDK:

| Our file | Replaces | What it does |
| --- | --- | --- |
| `runtime.ts` | `Runtime` | Deploys an agent: builds a container **in AWS**, creates the runtime, waits for it |
| `gateway.ts` | `GatewayClient` | Creates a Gateway, its login setup, and its tools |
| `memory.ts` | `MemoryClient` | Creates memory, stores conversations, retrieves preferences |
| `identity.ts` | `IdentityClient` | OAuth credential providers and workload identity |
| `observability-client.ts` | `ObservabilityClient` | Queries traces back out of CloudWatch |
| `evaluation.ts` | `Evaluation` | Creates evaluators and scores agent sessions |
| `policy.ts` | `PolicyClient` | Policy engines and Cedar rules |

**The guiding rule:** every class keeps its Python name and method names (in camelCase), and the
same arguments. A reader can put the Python cell and the TypeScript cell side by side and see only
a translation. That is what "only the language changes" means in practice.

`runtime.ts` deserves a note. Deploying means: create an IAM role, create a container registry,
zip the agent folder, upload it to S3, build an ARM64 container image **in AWS CodeBuild**, then
create the runtime and poll until ready. Building remotely is deliberate — it is how the Python
toolkit works, and it means **a learner never needs Docker installed**.

### Step 6 — Porting the notebooks, one at a time

Then eleven slices, in order, each its own ticket: the notebook plus whatever backend files it
owns. Each slice followed the same loop:

1. Port the notebook and its files.
2. Delete the Python originals in the same commit (never leave two versions).
3. **Run it against real AWS.**
4. Fix whatever that run exposed.
5. Ask the user to run the notebook in VS Code — the only check that exercises the real kernel.

Step 3 is where the value was. Type-checking proves the code is *shaped* right. Running proves it
*works*. Almost every real problem appeared at step 3.

## 6. The interesting problems, and how they were solved

### "It builds locally but fails in the cloud" — Docker Hub rate limits

The first deployment failed inside AWS CodeBuild with `429 Too Many Requests`. The build pulls the
Deno base image from Docker Hub, which rate-limits anonymous downloads **per IP address** — and
CodeBuild's IPs are shared with everyone else using CodeBuild.

**Fix:** pull the same image from GitHub's registry instead. One line. But a learner hitting this
on their first deploy would have no idea why.

### "The role exists but AWS says it doesn't" — IAM propagation

Create an IAM role, immediately use it, and AWS sometimes replies that it cannot be assumed. The
role is real; the permission system just has not caught up with itself yet.

**Fix:** retry with increasing waits. The Python toolkit does this too — but it does not recognise
the particular error message CodeBuild returns, so we widened it.

### "The agent cannot import its own helper" — self-contained deployments

The unified agent imported `MemoryClient` from the shared toolkit. That works on your laptop. It
fails in the cloud, because **only the agent's own folder gets zipped and shipped**. The import
points at a file that is not in the container.

Python never hit this: its memory client came from an installed package, and packages travel with
the container.

**Fix:** the deployed agent calls the AWS SDK directly for its two memory operations. Deployed
folders stay self-contained, which is exactly what the per-agent `deno.json` files already imply.

### "The lab cannot work at all" — three missing permissions

The policy lab (notebook 10) teaches you to block tool calls with Cedar rules. Running it revealed
that the Gateway is never granted permission to:

1. **invoke the Lambda functions** the lab deploys — AWS refuses to even *create* the tool,
2. **read the policy engine** it is being attached to,
3. **evaluate requests** against that engine (the calls enforcement makes on every request).

AWS reveals these one at a time, so finding them took four deploy-and-fail cycles. None is visible
without running against AWS. **The Python version of this lab cannot be completed as written.**

### "The guard that never guarded" — a subtle TypeScript trap

The evaluations lab renders formatted output in the notebook. Outside a notebook that feature does
not exist, so the code checked whether it was there:

```ts
const jupyter = Deno.jupyter;   // looks safe
if (jupyter) { ... }            // never reached
```

Reading `Deno.jupyter` outside the kernel **throws an error** rather than returning nothing. The
check could never run. Fixed by probing inside a `try`/`catch`.

Notice how this was found: we verify notebooks by extracting their cells and running them as a
plain script. Inside the kernel it would have worked, and the bug would have shipped.

## 7. What we found in the original Python

**Twenty-one bugs**, every one written up in the ticket where it was found. They fall into three
groups.

**Code that could never have run.** Two setup files imported SDK modules that do not exist in any
version of the library, and called methods that do not exist either. The standalone gateway script
read a dictionary as if it were an object, referenced a key that is never returned, and loaded an
API specification file that is not in the repository. These files were not "slightly broken" —
they had never worked.

**Things that break on the second run.** The evaluations lab creates an evaluator without checking
whether it already exists, so running the notebook twice stops with a name conflict and every
later cell is skipped.

**Quiet wrongness.** The direct API test script keeps its three API keys as empty strings, under a
comment saying they should come from the environment — so it always called the APIs with no key
and reported failure as though the APIs were down. A notebook saved an ID field that the API does
not return, writing `null` into a file the next notebook reads. Another decoded responses in a way
that mangles every non-ASCII character, in two tests that are specifically about euros.

None of this is a criticism of the original author — it is what happens to any codebase whose
error paths are never executed. It is also the strongest argument for the rule we adopted: *a slice
is not done until it has run against AWS.*

## 8. What the repository looks like now

```
deno.json          Dependencies (exact versions), tasks, lint and format settings
deno.lock          Locked versions
.deno-version      The Deno version the course is pinned to
setup.sh           Installs Deno, caches dependencies, registers the Jupyter kernel

capstone_project/
  notebooks/       The eleven course notebooks, now TypeScript on the Deno kernel
  toolkit/         Our rebuild of the Python starter toolkit (7 clients + tests)
  shared/
    observability.ts   Telemetry, loaded into every deployed agent automatically
    notebook.ts        Helpers replacing IPython's magic commands
  backend/         Agents and setup scripts, one folder per deployable agent

tests/             Direct API test utility
scripts/           check_pins.ts — keeps agent dependencies in step with the root
.scratch/          The map and all 29 tickets: why every decision was made
```

Two files deserve a closer look if you are new:

**`shared/observability.ts`** is loaded via `--preload`, which means it runs *before* the agent
starts and the agent code never mentions it. That mirrors Python, where a wrapper command did the
same job. It is also why agent files stay clean.

**`shared/notebook.ts`** replaces IPython's "magic" commands, which do not exist in Deno's kernel:

| IPython magic | Our replacement | Why |
| --- | --- | --- |
| `%store x` | `state.set("x", …)` | Pass values between notebooks |
| `!command` | `await sh("cmd", [...])` | Deno's kernel hides child-process output, so this prints it |
| `%%writefile path` | `await writeFile(path, …)` | Notebooks generate the agent files they deploy |
| `load_dotenv()` | `await loadEnv()` | Read `.env` |

## 9. Getting started yourself

```bash
./setup.sh                      # installs Deno, dependencies, and the notebook kernel
deno task test                  # 104 unit tests
deno task check                 # type-check and lint everything
```

Then open `capstone_project/notebooks/01-foundation.ipynb` in VS Code, choose the **Deno** kernel
(top right), and run the cells. Notebook 01 only checks your environment — nothing is created in
AWS until notebook 02.

For the notebooks that call third-party services, put the keys in a `.env` file at the repository
root (it is git-ignored):

```
AVIATIONSTACK_API_KEY=...
OPENWEATHERMAP_API_KEY=...
EXCHANGERATE_API_KEY=...
```

**A word of warning:** from notebook 02 onward these notebooks create real AWS resources — agent
runtimes, a gateway, memory, Lambda functions — and they cost real money. The three lab notebooks
(09–11) clean up after themselves. The earlier notebooks deliberately do not, because later
notebooks build on what they create.

## 10. What is still open

Two things, both waiting on credentials rather than code:

1. **Third-party verification.** The Gateway plumbing is proven end to end — a tool call travels
   from the agent, through the Gateway, picks up the stored key, and reaches the real API, which
   replies "invalid key" because the keys in `.env` are placeholders. With real keys it returns
   real data. The Google Drive OAuth flow is in the same position: the code is ported and the
   callback server is tested, but nobody has clicked through Google's consent screen yet.

2. **Online evaluation.** Evaluations come in two flavours. *On-demand* — you ask for a session to
   be scored — works completely, and the evaluations lab proves it. *Online* — AWS watches live
   traffic and scores it automatically — creates and enables correctly, but has never produced a
   result for a Deno agent, even after waiting well past the documented delay. The cause is not yet
   known; the ticket recording what was ruled out is `12-lab11-online-evaluation.md`.

Both are written up in `.scratch/typescript-port/issues/` so that whoever picks them up starts with
the evidence rather than from scratch.

## 11. The one lesson worth taking away

Almost everything that mattered in this project was found by **running the code against the real
system**, not by reading it or type-checking it.

Type-checking caught spelling mistakes. Running caught: a rate limit on a shared IP, a permissions
system that lags behind itself, a container that cannot see files outside its own folder, three
IAM permissions that AWS only reveals one failure at a time, and a safety check that throws instead
of returning false.

If you take one habit from this write-up, take that one.
