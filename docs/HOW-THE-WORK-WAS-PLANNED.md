# How the work was planned: the map, and every decision on it

*Companion to [HOW-THIS-PORT-WAS-BUILT.md](HOW-THIS-PORT-WAS-BUILT.md). That one is about the
code. This one is about how the work was organised, and why each choice was made.*

---

## 1. The problem this method solves

Imagine being handed this job: *"rewrite this Python course in TypeScript."*

Your instinct is to write a plan. So you sit down and try, and immediately you cannot:

- Does an AgentCore library even exist for TypeScript? You don't know.
- Can Jupyter notebooks run TypeScript without Python? You don't know.
- Will the deployed agents still report traces to CloudWatch? You don't know.
- How many notebooks will need rewriting versus translating? You don't know.

Any plan you write now is **invented**, not discovered. You would be committing to steps whose
feasibility you are guessing at. And the worst guess — the observability one — could force a
different runtime for the whole project, after weeks of work.

The method used here, called **wayfinding**, starts from the opposite assumption: *you cannot see
the whole route yet, so do not pretend to.* You chart what you can see, find out one thing at a
time, and let each answer reveal the next stretch of road.

## 2. The vocabulary

Six ideas, and they are all simple.

**Destination.** One or two sentences describing what "finished" looks like. Written first, because
it decides everything else. Ours:

> Every Python artifact — the backend, the 11 notebooks, tests, setup.sh, README — ported to
> TypeScript on Deno, keeping the same folders, file roles and behaviour, with the Python toolchain
> replaced by a Deno equivalent of the same shape and the originals deleted.

**The map.** One file (`.scratch/typescript-port/map.md`) holding the destination, standing rules,
and a one-line summary of every decision made so far. It is an *index*, not a store: the detail
lives in the tickets, and the map just points at them.

**Tickets.** One question each, small enough to answer in a single work session. A ticket is not a
task list item — it is a question whose answer is a decision or a finding.

**Blocking.** A ticket that depends on another is marked blocked. "Which TypeScript package replaces
each Python one?" cannot be answered before "does an AgentCore package exist at all?"

**The frontier.** The tickets that are open, unblocked and unclaimed — the work you can actually
start right now. You always take from the frontier.

**Fog of war.** The things you can tell are coming but cannot describe precisely yet. They go in a
"Not yet specified" section, deliberately vague, and sharpen into real tickets as you learn more.
The test for whether something is a ticket or fog is not *"can I answer it?"* but *"can I state
the question precisely?"*

There is also **Out of scope** — work consciously ruled outside the destination. Ours stayed empty,
which is itself informative: nothing turned out to be beyond the line we drew.

## 3. Four kinds of ticket

Each ticket says how it gets answered, which sets whether a human is needed.

| Type | Answered by | Needs a human? |
| --- | --- | --- |
| **Research** | Reading official docs and source code | No |
| **Spike** (a "task") | Building a throwaway thing to see if it works | No, but it may spend money |
| **Grilling** | A conversation where the human decides | **Yes** |
| **Port** (also a "task") | Doing the actual work | Only for final sign-off |

The distinction matters. A research ticket can run unattended. A grilling ticket **cannot** — the
whole point is that a person chooses, and an agent answering its own questions would defeat it.
Every decision in section 5 below came from a grilling session where options were laid out with a
recommendation, and the human picked.

## 4. What a working session looks like

1. Read the map — the low-resolution view, not every ticket.
2. Take the first ticket on the frontier. Claim it, so parallel sessions don't collide.
3. Answer it: research, build, or discuss.
4. Write the answer **into the ticket**, with evidence, and add a one-line pointer to the map.
5. Create any new tickets the answer revealed; promote fog that has become precise.
6. Stop. One ticket per session (research is the exception, since those run in parallel).

That last rule sounds inefficient. It is the opposite: it stops half-finished thinking from
leaking between unrelated questions, and it means the map is always an accurate picture of where
things stand.

**By the numbers, this project ran:** 1 map, 4 research tickets, 2 spikes, 7 decision tickets,
15 port tickets, and 2 still open. Twenty-nine in total, all readable in
`.scratch/typescript-port/issues/`.

## 5. Every decision, and why

### Decision 1 — What "only the language changes" actually means

**The problem:** the request said to keep the virtual environment and dependencies as they are. But
TypeScript cannot use a Python virtual environment. Taken literally, the request is impossible.

**What was decided:** keep the same *shape*, built from TypeScript's own parts — `deno.json` where
`pyproject.toml` was, a per-agent `deno.json` where each `requirements.txt` was, and so on. The
folder layout, the course flow and the AWS resources stay identical.

**Why it mattered:** this single clarification defined the whole project. Without it, every later
question ("where does this file go?") would have been re-litigated.

### Decision 2 — Deno, and Deno everywhere

**The problem:** which JavaScript runtime? And after the observability spike came back ambiguous,
a second question: should the *deployed agents* use a different runtime from everything else?

**What was decided:** Deno for everything, including inside AWS. Node 22 was kept as a fallback for
one lab only, if its telemetry proved impossible.

**The trade-off, stated honestly at the time:** Deno meant the repository owns ~100 lines of
telemetry code that Node would have got for free from an AWS library. Node meant two runtimes in
one repository, two dependency systems, and learners switching runtimes mid-course.

**Why Deno won:** the spike had already proved the telemetry worked, so the cost was known and
bounded, while the cost of two runtimes would have been permanent and visible to every learner.

**Did it hold?** Yes. The fallback was never needed.

### Decision 3 — Notebooks run on Deno's kernel, VS Code only

**What was decided:** the course targets VS Code plus two extensions. JupyterLab is not supported.

**Why:** Deno's kernel installs itself without Python, but JupyterLab is a Python application — 
supporting it would drag Python back into a course whose whole point is that it no longer needs it.

**What it cost:** a documented prerequisite. The README now says exactly which extensions to
install, and notebook 01 checks the kernel is registered.

### Decision 4 — Deploy by building containers remotely

**The problem:** a Deno agent has to ship as a container. Something must build it. Does the learner
need Docker installed?

**What was decided:** no. Builds happen in AWS CodeBuild, exactly as the Python toolkit did it.

**Why:** the Python course never required Docker, and "only the language changes" includes the
prerequisites. A new Docker requirement would have been a real change to the course.

**What it cost:** our `Runtime` helper is the biggest single file in the toolkit, because it has to
orchestrate roles, a registry, a zip upload, a remote build and the runtime creation. Worth it.

### Decision 5 — Rebuild the missing toolkit rather than shell out to a CLI

**The problem:** the Python starter toolkit has no TypeScript version. The notebooks use it
constantly. Three options: rebuild it as helper classes, call AWS's new command-line tool from
notebook cells, or write raw SDK calls in every cell.

**What was decided:** rebuild it, in `capstone_project/toolkit/`.

**Why:** it is the only option where the notebook cells stay recognisable. A cell that reads
`await runtime.launch()` diffs cleanly against Python's `agentcore_runtime.launch()`. A cell that
shells out to a CLI with a project config file teaches something different from what the course
teaches.

**What it cost:** roughly 6,800 lines the repository now owns and maintains. That is the real price
of "only the language changes" for this project, and it was accepted with eyes open.

### Decision 6 — Mirror the Python API exactly

**What was decided:** same class names, same method names in camelCase, same arguments, same return
shapes. `create_memory_and_wait(name=…, strategies=[…])` becomes
`createMemoryAndWait({ name, strategies })`.

**Why:** a reader of the course can hold the two versions side by side and see a translation rather
than a redesign. An idiomatic TypeScript rewrite would have been prettier and wrong for this brief.

### Decision 7 — The dependency mapping

Several small choices, decided together:

- **Six unused dependencies were dropped**, not mapped. Nothing imported beautifulsoup4, selenium,
  structlog, watchtower, nest-asyncio or google-auth-oauthlib. Carrying them over would have meant
  picking libraries no code exercises.
- **Platform built-ins beat libraries**: `fetch` replaces `requests`; `Deno.serve` replaces FastAPI
  and uvicorn; Deno's standard library replaces `python-dotenv`.
- **Official clients stay official**: the AWS SDK for JavaScript, `googleapis`, and the Strands and
  AgentCore packages.
- **Exact version pins, everywhere.** Several packages are pre-1.0 and none officially supports
  Deno; a course that breaks on someone else's release is a bad course.
- **pandas, numpy and matplotlib are not dependencies at all.** They only appear inside Python text
  the notebooks send to the Code Interpreter sandbox — which stays Python, because the sandbox
  being a Python service is the lesson.

### Decision 8 — Toolchain layout

**What was decided:** one root `deno.json`, plus a small `deno.json` inside each deployable agent
folder, mirroring where each `requirements.txt` used to sit. A script (`scripts/check_pins.ts`)
verifies the per-agent files agree with the root.

**Why:** each agent folder must be independently deployable, because that folder is what gets
zipped and shipped. A single shared config would have broken that.

**This decision paid off later, twice.** It is exactly why a deployed agent cannot import the shared
toolkit — a constraint discovered during notebook 08 — and the per-agent config made the fix
obvious rather than surprising.

### Decision 9 — What to do about code that was already broken

**The problem:** three Python files could never have run. Two imported modules that exist in no
version of the SDK; one called methods on a dictionary as though it were an object.

**What was decided:** port the *intent*, fix the bug, and log the fix. If the intent is unclear,
stop and ask. This became a standing rule in the map's Notes, applied by every later session.

**Why:** "only the language changes" should mean "the intended behaviour is preserved", not "the
bugs are preserved". But silently fixing things is how a port becomes unreviewable — hence the
logging requirement.

**What it produced:** twenty-one logged bugs, each in the ticket where it was found.

### Decision 10 — How the work was sliced

**What was decided:** one ticket per notebook, including whichever backend files that notebook
owns. Python deleted in the same commit as its working TypeScript replacement. One long-lived
branch. And the definition of done: **it has run against AWS**, then the human opens it in VS Code.

**Why one notebook per slice:** the notebook is the unit that can actually be verified. A backend
file alone proves nothing.

**Why delete per slice:** no half-ported limbo where both versions exist and neither is trusted.

**Why "run against AWS":** this is the decision that produced almost all the value. Type-checking
found typos. Running found a rate limit on shared IP addresses, an IAM system that lags behind
itself, a container that cannot see outside its own folder, and three missing permissions that AWS
only reveals one failure at a time.

### Decision 11 — Telemetry lives outside the agent code

**What was decided:** the observability module is loaded with Deno's `--preload` flag, so it runs
before the agent starts and the agent never imports it.

**Why:** Python did the same thing with a wrapper command, so agent files there carry no telemetry
code either. Matching that keeps the course's agent files clean and comparable.

**What was verified before committing to it:** that a preloaded module can register itself early
enough, and that it can still pick up the session ID from the incoming request. Both were tested
live rather than assumed.

## 6. Decisions that changed as we learned

A map is not a contract. Four things shifted:

| What changed | Why |
| --- | --- |
| Two dependencies added after the "final" mapping table | Zipping needs a library (Python's is built in); one AWS client was missed |
| "Run `deno fmt` from the repo root only" → an explicit exclude list | The first rule was wrong: formatting was quietly rewriting notebooks and third-party API specs |
| Deployed agents may not import shared code | Discovered when a deployment failed; folded back into the layout decision |
| Our own IAM policies grew three times | Each live run revealed a permission the Python toolkit never grants |

Each change was recorded in the ticket where it surfaced, so the reasoning is preserved rather than
just the outcome.

## 7. What the method cost, and what it bought

**It cost** more ceremony than a to-do list: writing questions down, recording answers, keeping the
map honest. Roughly a third of the tickets produced no code at all.

**It bought** four things that mattered:

1. **The riskiest unknown was settled first.** The observability spike ran before any porting. Had
   it failed, the runtime decision would have changed — cheaply, at the start, instead of expensively
   near the end.
2. **Decisions have a written reason.** Six months from now, "why is there a hand-written telemetry
   exporter in here?" has an answer, with the three approaches that were tried and what each did.
3. **Work could be parallelised safely.** Four research questions ran at once. Six toolkit helpers
   were written by three workers simultaneously, because the interfaces had already been decided.
4. **Unfinished work is honest.** Two tickets are still open, and both say precisely what was ruled
   out and what to try next — rather than being silently dropped or quietly marked done.

**Where it was clumsy:** progress on long-running background work was checked by polling rather than
waiting for notifications, which produced some noise. And one grilling round offered a choice
between options that were not truly independent, so a follow-up round was needed.

## 8. The two tickets still open

**`29-verify-with-real-credentials.md`** — the Gateway path is proven end to end, but the API keys
in `.env` are placeholders, so tool calls come back "invalid key" from the upstream APIs. The Google
OAuth flow is ported and its callback server tested, but nobody has clicked through Google's consent
screen. The ticket lists the exact steps, including which credentials to create where.

**`12-lab11-online-evaluation.md`** — evaluations come in two kinds. *On-demand* scoring works
completely. *Online* scoring — AWS watching live traffic — creates and enables correctly but has
never produced a result for a Deno agent, even well past the documented delay. The ticket records
what was ruled out (the instrumentation scope name, which was the obvious suspect) and three things
worth trying next, in order of promise.

Neither blocks anything. Both are written so that a person picking them up starts from evidence.

## 9. If you want to continue this work

Read the map first (`.scratch/typescript-port/map.md`) — the destination, the standing rules, and
the one-line summary of all 27 resolved tickets. Then open the two open tickets and take whichever
you have credentials for.

Keep the habits that made it work:

- One question per ticket; write the answer where the question lives.
- Decide with a human when it is a decision; research alone when it is a fact.
- Finish nothing until it has run against the real system.
- When you find a bug in the original, fix the intent and **write down what you changed**.
