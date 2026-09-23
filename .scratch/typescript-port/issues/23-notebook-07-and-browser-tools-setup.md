# Port: notebook 07 and browser tools setup

Type: task
Status: resolved
Blocked by: 22

## Question

Port `07-browser-tools.ipynb` (Strands agent with `BrowserTools` over Playwright) and rebuild `backend/browser_tools_setup.py` as `.ts` on the real `Browser` API.

The TS browser tool has 7 actions against Python's ~22; check which the notebook actually needs and record any gap here. Replace the `!uv add` cell per the notebook helper's conventions.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit da81f71.

**`browser_tools_setup.py` rebuilt, not translated** — the same story as the code interpreter file. It imported `bedrock_agentcore.services.browser_tools.BrowserToolsClient` (exists in no SDK version) and called `create_session`, `list_sessions` and an `execute_actions` loop that do not exist. The real API starts a **session** against the built-in browser and drives it over CDP with Playwright. `browser_tools_setup.ts` keeps the intent: start a session, connect, navigate to a travel page, read title and heading, report, stop in a `finally`.

**Notebook 07** is 8 code cells: browser tool init, agent with all 7 browser tools, the two original research prompts, an added cell that stops the session, and the saved config. The `!uv add` cell becomes a comment explaining that dependencies are pinned in `deno.json` and cached by `setup.sh`, plus a `deno --version` check through the shell helper.

**Verified live in 362249012325/us-east-1:**
- The rebuilt script started session `01M35TTH0YVYKWZRZ1KKVRBEG5`, Playwright connected over CDP to the **remote** browser, loaded louvre.fr and read back "Musée du Louvre Official Website" / "Louvre - Homepage". Session stopped.
- The notebook agent drove **navigate, screenshot, getText and click** against the live site across 9 tool calls.

**This closes the last unverified item from the Strands research:** `chromium.connectOverCDP` works under Deno. The browser runs in AWS, so nothing is downloaded locally.

**Caveat, not a port defect:** the Louvre ticketing page is behind Cloudflare verification and the Paris Opera prompt ends with the agent explaining it could not read the site. The tools worked; the sites block automation. The Python course hits the same walls, and the browser tool's 7 TypeScript actions were enough for every step the agent attempted — no gap against Python's ~22 showed up here.

**Added to .gitignore:** `browser_tools_info.json` (generated at runtime).
