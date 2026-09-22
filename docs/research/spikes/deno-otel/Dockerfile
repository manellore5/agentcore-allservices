FROM --platform=linux/arm64 denoland/deno:2.9.7
WORKDIR /app
COPY deno.json deno.lock ./
COPY main.ts telemetry.ts ./
RUN deno install --entrypoint main.ts && deno cache main.ts
USER 1993
EXPOSE 8080
CMD ["run", "-A", "main.ts"]
