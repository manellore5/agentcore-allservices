import { assertEquals } from "@std/assert";
import type { Policy, PolicyEngine } from "@aws-sdk/client-bedrock-agentcore-control";
import {
  cedarStatement,
  collectPages,
  findByName,
  policyDefinitionFromGenerationAsset,
} from "./policy.ts";

Deno.test("findByName picks the engine the lab reuses", () => {
  const engines = [
    { name: "OtherEngine", policyEngineId: "pe-1" },
    { name: "InsuranceUnderwritingPolicyEngine", policyEngineId: "pe-2" },
  ] as PolicyEngine[];
  assertEquals(findByName(engines, "InsuranceUnderwritingPolicyEngine")?.policyEngineId, "pe-2");
  assertEquals(findByName(engines, "MissingEngine"), undefined);
  assertEquals(findByName([] as Policy[], "policy_create_application"), undefined);
});

Deno.test("cedarStatement reads the statement out of a cedar definition", () => {
  assertEquals(
    cedarStatement({ cedar: { statement: "permit(principal, action, resource);" } }),
    "permit(principal, action, resource);",
  );
  assertEquals(cedarStatement(undefined), undefined);
  assertEquals(
    cedarStatement({
      policyGeneration: { policyGenerationId: "pg-1", policyGenerationAssetId: "pga-1" },
    }),
    undefined,
  );
});

Deno.test("policyDefinitionFromGenerationAsset builds the generation definition", () => {
  assertEquals(policyDefinitionFromGenerationAsset("pg-1", "pga-1"), {
    policyGeneration: { policyGenerationId: "pg-1", policyGenerationAssetId: "pga-1" },
  });
});

Deno.test("collectPages follows nextToken until the listing is exhausted", async () => {
  const pages = [
    { items: ["a", "b"], nextToken: "t1" },
    { items: ["c"], nextToken: "t2" },
    { items: ["d"] },
  ];
  const seenTokens: (string | undefined)[] = [];
  let call = 0;
  const all = await collectPages<string>((nextToken) => {
    seenTokens.push(nextToken);
    return Promise.resolve(pages[call++]);
  });
  assertEquals(all, ["a", "b", "c", "d"]);
  assertEquals(seenTokens, [undefined, "t1", "t2"]);
});

Deno.test("collectPages returns nothing for an empty first page", async () => {
  assertEquals(await collectPages<string>(() => Promise.resolve({})), []);
});
