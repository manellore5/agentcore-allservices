import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildApiKeyCredentialProviderConfiguration,
  buildGatewayAccessPolicy,
  buildGatewayCredentialProviderPolicy,
  buildGatewayTrustPolicy,
  buildTargetConfiguration,
  buildTokenRequestBody,
  type CognitoClientInfo,
  credentialProviderPolicyName,
  extractIdFromArn,
  GatewayClient,
  getPartition,
  jsonEquals,
  Logger,
  roleNameFromArn,
} from "./gateway.ts";

Deno.test("getPartition maps a region to its AWS partition", () => {
  assertEquals(getPartition("us-west-2"), "aws");
  assertEquals(getPartition("eu-central-1"), "aws");
  assertEquals(getPartition("cn-north-1"), "aws-cn");
  assertEquals(getPartition("us-gov-west-1"), "aws-us-gov");
  assertEquals(getPartition("us-iso-east-1"), "aws-iso");
  assertEquals(getPartition("us-iso-b-east-1"), "aws-iso-b");
});

Deno.test("extractIdFromArn returns the last ARN segment, or the id as given", () => {
  assertEquals(extractIdFromArn("gateway-123"), "gateway-123");
  assertEquals(
    extractIdFromArn("arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/gateway-123"),
    "gateway-123",
  );
  assertEquals(extractIdFromArn("arn:aws:iam::123456789012:role/MyRole"), "MyRole");
  assertEquals(
    roleNameFromArn("arn:aws:iam::123456789012:role/AgentCoreGatewayExecutionRole"),
    "AgentCoreGatewayExecutionRole",
  );
});

Deno.test("buildGatewayTrustPolicy scopes AssumeRole to the account and region", () => {
  const policy = buildGatewayTrustPolicy("us-west-2", "123456789012");
  assertEquals(policy.Version, "2012-10-17");
  assertEquals(policy.Statement.length, 1);
  const statement = policy.Statement[0];
  assertEquals(statement.Principal, { Service: "bedrock-agentcore.amazonaws.com" });
  assertEquals(statement.Action, "sts:AssumeRole");
  assertEquals(statement.Condition?.StringEquals["aws:SourceAccount"], "123456789012");
  assertEquals(
    statement.Condition?.ArnLike["aws:SourceArn"],
    "arn:aws:bedrock-agentcore:us-west-2:123456789012:*",
  );
});

Deno.test("buildGatewayTrustPolicy carries the partition into the SourceArn", () => {
  const policy = buildGatewayTrustPolicy("cn-north-1", "123456789012");
  assertEquals(
    policy.Statement[0].Condition?.ArnLike["aws:SourceArn"],
    "arn:aws-cn:bedrock-agentcore:cn-north-1:123456789012:*",
  );
});

Deno.test("buildGatewayAccessPolicy scopes GetGateway to the gateway name prefix", () => {
  const policy = buildGatewayAccessPolicy("us-east-1", "123456789012", "travelmategateway");
  assertEquals(policy.Statement.map((s) => s.Sid), [
    "GetGateway",
    "GetConfigurationBundleVersion",
  ]);
  assertEquals(policy.Statement[0].Resource, [
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/travelmategateway-*",
  ]);
  assertEquals(policy.Statement[1].Condition?.StringEquals["aws:RequestedRegion"], "us-east-1");
  assertEquals(
    policy.Statement[1].Condition?.StringEquals["aws:ResourceAccount"],
    "${aws:PrincipalAccount}",
  );
});

Deno.test("buildGatewayCredentialProviderPolicy picks the actions per provider kind", () => {
  const apikey = buildGatewayCredentialProviderPolicy(
    "us-west-2",
    "123456789012",
    "WeatherTarget-ApiKey-abcd1234",
    "apikey",
  );
  assertEquals(apikey.Statement[0].Action, ["bedrock-agentcore:GetResourceApiKey"]);
  assertEquals(apikey.Statement[0].Resource, [
    "arn:aws:bedrock-agentcore:us-west-2:123456789012:token-vault/default",
    "arn:aws:bedrock-agentcore:us-west-2:123456789012:token-vault/default/apikeycredentialprovider/WeatherTarget-ApiKey-abcd1234*",
  ]);
  assertEquals(apikey.Statement[1].Resource, [
    "arn:aws:secretsmanager:us-west-2:123456789012:secret:bedrock-agentcore-identity!default/apikey/WeatherTarget-ApiKey-abcd1234-*",
  ]);

  const oauth = buildGatewayCredentialProviderPolicy(
    "us-west-2",
    "123456789012",
    "DriveTarget",
    "oauth2",
  );
  assertEquals(oauth.Statement[0].Action, ["bedrock-agentcore:GetResourceOauth2Token"]);
  assertStringIncludes(
    (oauth.Statement[0].Resource as string[])[1],
    "token-vault/default/oauth2credentialprovider/DriveTarget*",
  );
});

Deno.test("credentialProviderPolicyName truncates to the IAM 128 character limit", () => {
  assertEquals(
    credentialProviderPolicyName("apikey", "WeatherTarget-ApiKey-abcd1234"),
    "GatewayCredentialProvider-apikey-WeatherTarget-ApiKey-abcd1234",
  );
  const name = credentialProviderPolicyName("oauth2", "x".repeat(200));
  assertEquals(name.length, 128);
  assert(name.startsWith("GatewayCredentialProvider-oauth2-"));
});

Deno.test("buildTargetConfiguration nests the payload under the target type", () => {
  assertEquals(
    buildTargetConfiguration("openApiSchema", { inlinePayload: '{"openapi":"3.0.0"}' }),
    { mcp: { openApiSchema: { inlinePayload: '{"openapi":"3.0.0"}' } } },
  );
  assertEquals(
    buildTargetConfiguration("lambda", {
      lambdaArn: "arn:aws:lambda:us-east-1:123456789012:function:AgentCore-Policy-ApprovalTool",
      toolSchema: {
        inlinePayload: [{
          name: "approve_claim",
          description: "Approves a claim",
          inputSchema: { type: "object" },
        }],
      },
    }),
    {
      mcp: {
        lambda: {
          lambdaArn: "arn:aws:lambda:us-east-1:123456789012:function:AgentCore-Policy-ApprovalTool",
          toolSchema: {
            inlinePayload: [{
              name: "approve_claim",
              description: "Approves a claim",
              inputSchema: { type: "object" },
            }],
          },
        },
      },
    },
  );
});

Deno.test("buildApiKeyCredentialProviderConfiguration maps the credentials dict", () => {
  assertEquals(
    buildApiKeyCredentialProviderConfiguration(
      "arn:aws:bedrock-agentcore:us-west-2:123456789012:token-vault/default/apikeycredentialprovider/p",
      {
        apiKey: "secret-key",
        credentialLocation: "QUERY_PARAMETER",
        credentialParameterName: "appid",
      },
    ),
    {
      credentialProviderType: "API_KEY",
      credentialProvider: {
        apiKeyCredentialProvider: {
          providerArn:
            "arn:aws:bedrock-agentcore:us-west-2:123456789012:token-vault/default/apikeycredentialprovider/p",
          credentialLocation: "QUERY_PARAMETER",
          credentialParameterName: "appid",
        },
      },
    },
  );
});

Deno.test("buildTokenRequestBody form-encodes the client-credentials request", () => {
  const clientInfo: CognitoClientInfo = {
    client_id: "1example23",
    client_secret: "s3cr3t/value+here",
    user_pool_id: "us-west-2_abc",
    token_endpoint: "https://agentcore-abcd1234.auth.us-west-2.amazoncognito.com/oauth2/token",
    scope: "TravelMateGateway/invoke",
    domain_prefix: "agentcore-abcd1234",
  };
  const params = new URLSearchParams(buildTokenRequestBody(clientInfo));
  assertEquals(params.get("grant_type"), "client_credentials");
  assertEquals(params.get("client_id"), "1example23");
  assertEquals(params.get("client_secret"), "s3cr3t/value+here");
  assertEquals(params.get("scope"), "TravelMateGateway/invoke");
});

Deno.test("jsonEquals compares trust policies regardless of key order", () => {
  const expected = buildGatewayTrustPolicy("us-west-2", "123456789012");
  const reordered = JSON.parse(
    JSON.stringify({ Statement: expected.Statement, Version: expected.Version }),
  );
  assert(jsonEquals(expected, reordered));
  assert(!jsonEquals(expected, buildGatewayTrustPolicy("us-east-1", "123456789012")));
  assert(!jsonEquals(expected, { Version: "2012-10-17", Statement: [] }));
  assert(jsonEquals(null, null));
  assert(!jsonEquals(null, {}));
});

Deno.test("Logger keeps quiet below the level the notebook sets", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    const logger = new Logger("bedrock_agentcore.gateway");
    logger.info("chatty");
    logger.setLevel("WARNING");
    logger.info("hidden");
    logger.warning("kept");
  } finally {
    console.error = original;
  }
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0], "INFO - chatty");
  assertStringIncludes(lines[1], "WARNING - kept");
});

Deno.test("generateRandomId returns the first 8 characters of a UUID", () => {
  const id = GatewayClient.generateRandomId();
  assertEquals(id.length, 8);
  assert(/^[0-9a-f]{8}$/.test(id));
});
