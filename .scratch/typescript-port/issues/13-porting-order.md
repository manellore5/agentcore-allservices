# Porting order and ticket slicing

Type: grilling
Status: resolved
Blocked by:

## Question

All the planning decisions are made. How does the migration split into session-sized port tickets, and in what order?

Material: ~2,000 lines of backend Python across 13 files, ~4,900 lines of notebook code cells across 11 notebooks, `tests/`, `setup.sh`, the README, plus new code the decisions call for (the `toolkit/` helpers, `shared/observability.ts`, `shared/notebook.ts`).

Points to settle:
- The first slice. The toolchain skeleton (`deno.json`, `.deno-version`, `setup.sh`) plus `shared/observability.ts` is the natural candidate, since the spikes have already proven that code.
- Whether the `toolkit/` helpers are one ticket or several (the `Runtime` helper alone is 300–400 lines), and whether they come before the notebooks that use them.
- Whether each notebook is its own ticket, and whether its backend files port with it or separately, given that 02, 05 and 08 generate backend files with `%%writefile`.
- How "verified against AWS" is satisfied per ticket, and which tickets can run in parallel.
- When the Python originals get deleted: per slice, or all at the end.
- Where port work lands: one branch, or a branch per ticket.

The output is the set of port tickets, wired with blocking edges.

## Answer

Decided with the user on 2026-09-22. 15 port tickets created (see "Port: ..." tickets), wired in a chain.

1. **A slice is one notebook plus the backend files it owns.** The notebook is the unit that can be verified against AWS. Split a notebook ticket only if a session runs out of room; 05 and 08 are the likely candidates.
2. **Toolkit split in two:** the six smaller helpers in one ticket, `Runtime` with its CodeBuild pipeline in another. Each helper gets its real verification in the notebook ticket that uses it.
3. **One long-lived `typescript-port` branch,** a commit per ticket, merged to main only when 01–11 all pass. Main stays runnable in Python throughout.
4. **Python deleted per slice,** in the same commit as the working TypeScript. The root toolchain files (`pyproject.toml`, `uv.lock`, `.python-version`) go in the final ticket.
5. **Verification per ticket:** the session extracts the notebook's code cells and runs them in order as a Deno script against AWS; the user then opens the notebook in VS Code as the final gate, which is what catches kernel-level problems.
6. **AWS resources:** created with the course's own names and kept across tickets, as a learner would, with the labs' cleanup cells run at the end. The session confirms with the user before creating new billable resources.
7. **Order:** skeleton first; then the two toolkit tickets, which may run in parallel; then notebooks 01→11 strictly in order, since they share state through `environments/*.json`; then tests, README and removal.

Ticket chain: skeleton -> {toolkit helpers, toolkit runtime} and notebook 01 -> notebook 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09 -> 10 -> 11 -> tests/README/removal.
