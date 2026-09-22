# Lab 11's online evaluation on a Deno agent

Type: grilling
Status: open
Blocked by:

## Question

The logs/preload spike showed on-demand evaluation scoring a Deno agent, but an online evaluation config produced no results in ~37 minutes, with the scope-name theory ruled out. Lab 11 teaches both. What does the course do?

- **(a) Investigate further while porting lab 11**, e.g. wait much longer, compare a Python agent's log records in the same account side by side with ours, try emitting one log record per message rather than per span, or send spans to the runtime log group as well.
- **(b) Run only the lab 11 agent on Node 22 with ADOT**, the fallback already agreed in the runtime decision, and keep Deno everywhere else.
- **(c) Change the lab** to teach on-demand evaluation only, and explain online evaluation without running it.

(a) is the natural first step, time-boxed, since a Python agent in the same account would show exactly what the service expects. Decide this when lab 11 is ported, not before, and treat it as blocking nothing else.

Background: the answer on the logs/preload spike ticket, plus `docs/research/spikes/deno-otel-logs/` on branch `research/deno-observability-spike`.
