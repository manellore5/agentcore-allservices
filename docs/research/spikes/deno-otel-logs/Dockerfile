FROM denoland/deno:2.9.7
WORKDIR /app
COPY deno.json deno.lock ./
COPY agent.ts observability.ts ./
RUN deno install --entrypoint agent.ts observability.ts && deno cache agent.ts observability.ts
USER 1993
EXPOSE 8080
CMD ["run", "-A", "--preload", "observability.ts", "agent.ts"]
