# Verify the notebooks that need third-party credentials

Type: task
Status: open
Blocked by:

## Question

Two slices were ported and verified only as far as AWS allows, because they need third-party credentials the user had not set up at the time. Once those exist, run them and record the results.

**Notebook 03 — gateway tool calls.** `.env` currently holds placeholder API keys, so the gateway targets exist but every tool call returns 401 from the upstream API. With real AviationStack, OpenWeatherMap and ExchangeRate keys: update the three API-key credential providers (or re-run the target cells), then run the weather, currency and flight test cells and confirm real data. The gateway path itself is already proven end to end.

**Notebook 05 — the OAuth2 flow.** Needs a Google Cloud OAuth client (Drive API enabled, `http://localhost:9090/oauth2/callback` as a redirect URI, consent screen with the user as a test user) and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`. Then: create the `google-drive-provider` credential provider, deploy `travel_agent_google_drive`, register the callback URL on its workload identity, start the callback server (`deno task oauth:server --region us-east-1`), invoke the agent, open the authorization URL it prints, and confirm an itinerary file appears in Drive.

Ask the user about these credentials before notebook 08's ticket, since the final unified agent uses both the gateway tools and the Drive integration.
