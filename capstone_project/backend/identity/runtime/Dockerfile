FROM ghcr.io/denoland/deno:2.9.7
WORKDIR /app
COPY deno.json* deno.lock* ./
COPY . .
RUN deno install --entrypoint travel_agent_google_drive.ts observability.ts && deno cache travel_agent_google_drive.ts observability.ts
USER 1993
EXPOSE 8080
CMD ["run", "-A", "--preload", "observability.ts", "travel_agent_google_drive.ts"]
