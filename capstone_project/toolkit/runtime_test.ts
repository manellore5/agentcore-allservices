import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  arm64Buildspec,
  buildDockerfile,
  codeBuildRolePolicy,
  deterministicSuffix,
  executionRolePolicy,
  executionRoleTrustPolicy,
  generateImageTag,
  generateSessionId,
  partitionForRegion,
  sanitizeEcrRepoName,
  shouldIgnoreSourceEntry,
} from "./runtime.ts";

Deno.test("sanitizeEcrRepoName matches the Python rules", () => {
  assertEquals(sanitizeEcrRepoName("TravelAgent"), "travelagent");
  assertEquals(sanitizeEcrRepoName("travel_agent.v2"), "travel_agent-v2");
  assertEquals(sanitizeEcrRepoName("-agent-"), "a-agent");
  assertEquals(sanitizeEcrRepoName("a"), "a-agent");
  assertEquals(sanitizeEcrRepoName("a__b--c"), "a-b-c");
  assertEquals(sanitizeEcrRepoName("x".repeat(250)).length, 200);
});

Deno.test("generateImageTag formats a UTC timestamp", () => {
  assertEquals(
    generateImageTag(new Date(Date.UTC(2026, 8, 22, 4, 5, 6, 70))),
    "20260922-040506-070",
  );
  assertMatch(generateImageTag(), /^\d{8}-\d{6}-\d{3}$/);
});

Deno.test("deterministicSuffix is stable per agent name", async () => {
  const first = await deterministicSuffix("travel-agent");
  assertEquals(first, await deterministicSuffix("travel-agent"));
  assertEquals(first.length, 10);
  assertMatch(first, /^[0-9a-f]{10}$/);
  assert(first !== await deterministicSuffix("other-agent"));
});

Deno.test("partitionForRegion covers the AWS partitions", () => {
  assertEquals(partitionForRegion("us-east-1"), "aws");
  assertEquals(partitionForRegion("cn-north-1"), "aws-cn");
  assertEquals(partitionForRegion("us-gov-west-1"), "aws-us-gov");
  assertEquals(partitionForRegion("us-iso-east-1"), "aws-iso");
  assertEquals(partitionForRegion("us-iso-b-east-1"), "aws-iso-b");
});

Deno.test("the trust policy restricts the service to this account and region", () => {
  const policy = executionRoleTrustPolicy("123456789012", "us-east-1") as {
    Statement: [
      { Principal: { Service: string }; Condition: Record<string, Record<string, string>> },
    ];
  };
  const statement = policy.Statement[0];
  assertEquals(statement.Principal.Service, "bedrock-agentcore.amazonaws.com");
  assertEquals(statement.Condition.StringEquals["aws:SourceAccount"], "123456789012");
  assertEquals(
    statement.Condition.ArnLike["aws:SourceArn"],
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:*",
  );
});

Deno.test("the execution policy scopes ECR to the agent's own repository", () => {
  const policy = executionRolePolicy(
    "123456789012",
    "us-east-1",
    "travel-agent",
    "bedrock-agentcore-travel-agent",
  );
  const statements = (policy as { Statement: { Sid?: string; Resource: unknown }[] }).Statement;
  const ecr = statements.find((s) => s.Sid === "ECRImageAccess")!;
  assertEquals(ecr.Resource, [
    "arn:aws:ecr:us-east-1:123456789012:repository/bedrock-agentcore-travel-agent",
  ]);
});

Deno.test("the execution policy grants the span permissions the SigV4 exporter needs", () => {
  const policy = executionRolePolicy("1", "us-east-1", "a", "r");
  const actions = (policy as { Statement: { Action: string | string[] }[] }).Statement
    .flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
  for (const needed of ["xray:PutSpans", "xray:PutSpansForIndexing", "bedrock:InvokeModel"]) {
    assert(actions.includes(needed), `missing ${needed}`);
  }
});

Deno.test("the CodeBuild policy confines S3 access to the source bucket and account", () => {
  const policy = codeBuildRolePolicy(
    "123456789012",
    "us-east-1",
    "arn:aws:ecr:us-east-1:123456789012:repository/r",
    "src-bucket",
  );
  const s3 = (policy as {
    Statement: {
      Action: string[];
      Resource: unknown;
      Condition?: Record<string, Record<string, string>>;
    }[];
  }).Statement.find((s) => s.Action.includes("s3:GetObject"))!;
  assertEquals(s3.Resource, ["arn:aws:s3:::src-bucket", "arn:aws:s3:::src-bucket/*"]);
  assertEquals(s3.Condition!.StringEquals["s3:ResourceAccount"], "123456789012");
});

Deno.test("the buildspec tags and pushes the image it just built", () => {
  const spec = arm64Buildspec("123.dkr.ecr.us-east-1.amazonaws.com/repo", "20260922-040506-070");
  assertStringIncludes(spec, "docker build -t bedrock-agentcore-arm64 .");
  assertStringIncludes(
    spec,
    "docker tag bedrock-agentcore-arm64:latest 123.dkr.ecr.us-east-1.amazonaws.com/repo:20260922-040506-070",
  );
  assertStringIncludes(
    spec,
    "docker push 123.dkr.ecr.us-east-1.amazonaws.com/repo:20260922-040506-070",
  );
});

Deno.test("the Dockerfile preloads observability and runs as the non-root user", () => {
  const dockerfile = buildDockerfile("travel_agent.ts", "2.9.7");
  assertStringIncludes(dockerfile, "FROM ghcr.io/denoland/deno:2.9.7"); // Docker Hub rate-limits CodeBuild
  assertStringIncludes(
    dockerfile,
    'CMD ["run", "-A", "--preload", "observability.ts", "travel_agent.ts"]',
  );
  assertStringIncludes(dockerfile, "USER 1993");
  assertStringIncludes(dockerfile, "EXPOSE 8080");
});

Deno.test("source zips skip local clutter and the config file", () => {
  for (const ignored of [".git", "node_modules", ".env", ".bedrock_agentcore.json", "agent.pyc"]) {
    assert(shouldIgnoreSourceEntry(ignored), `${ignored} should be ignored`);
  }
  for (const kept of ["travel_agent.ts", "deno.json", "identity_helper.ts"]) {
    assert(!shouldIgnoreSourceEntry(kept), `${kept} should be kept`);
  }
});

Deno.test("session ids clear the runtime's 33-character minimum", () => {
  const id = generateSessionId();
  assert(id.length >= 33, `too short: ${id.length}`);
  assert(id !== generateSessionId());
});

Deno.test("isRoleNotReadyError spots the three IAM propagation failures", async () => {
  const { isRoleNotReadyError } = await import("./runtime.ts");
  const err = (name: string, message: string) => Object.assign(new Error(message), { name });

  assert(isRoleNotReadyError(err("ValidationException", "Role validation failed for arn:...")));
  assert(isRoleNotReadyError(err("InvalidParameterValueException", "The role cannot be assumed")));
  // CodeBuild's own wording, seen on a live deploy
  assert(isRoleNotReadyError(
    err(
      "InvalidInputException",
      "CodeBuild is not authorized to perform: sts:AssumeRole on service role",
    ),
  ));

  assert(!isRoleNotReadyError(err("AccessDeniedException", "not authorized")));
  assert(!isRoleNotReadyError(err("ResourceAlreadyExistsException", "exists")));
  assert(!isRoleNotReadyError(undefined));
});
