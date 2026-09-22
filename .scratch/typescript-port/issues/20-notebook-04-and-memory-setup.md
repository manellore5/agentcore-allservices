# Port: notebook 04 and memory setup

Type: task
Status: resolved
Blocked by: 19

## Question

Port `04-memory-implementation.ipynb` and `backend/memory/memory_setup.py`, using the toolkit `MemoryClient` (createMemoryAndWait, listMemories, getMemoryStrategies, createEvent, retrieveMemories).

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit 49ba991.

**Ported:**
- `backend/memory/memory_setup.ts` — `createTravelMemory`, `getNamespaces`, `seedTravelPreferences`, plus the exported `travelStrategies` and `travelInteractions` the notebook reuses. Runs standalone through `import.meta.main`.
- `04-memory-implementation.ipynb` — 8 code cells: strategy definitions, create-with-wait including the already-exists fallback, strategy verification, seeding, retrieval, and the saved memory info.
- Deleted `memory_setup.py`.
- `toolkit/mod.ts` now also exports `MemoryStrategyDict` and `StrategyConfigInput`, which the strategy literals need to type-check.

**Verified live in 362249012325/us-east-1:**
- `TravelMateMemory-uKqPP2CFRW` created, ACTIVE after 143s.
- All three strategies present. Note AWS reports the summary strategy's type as `SUMMARIZATION` while the input key is `summaryMemoryStrategy`; the normalisation in `MemoryClient` handles both.
- The 8-message event stored (`0000001790113348323#a9a9ce49`).
- **Retrieval verified after extraction caught up:** the preferences namespace returned an extracted record — "Budget is usually around $3000-5000 for a 10-day international trip", with its context and categories. Immediately after seeding it returns nothing, which is what the Python notebook's "memories may take time to process" refers to; the notebook keeps that 30s wait and the same warning.

No bugs found in this slice: the Python original is sound, and the `MemoryClient` port needed no changes.

**Repo hygiene:** `environments/memory_info.json` is untracked now, like the other generated environment files. It was tracked from the initial commit as an empty placeholder, so the earlier gitignore entry did not cover it. `identity_info.json` is still tracked and empty; notebook 05's ticket should untrack it the same way.
