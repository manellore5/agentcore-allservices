// Unit tests for the pure helper ported out of Python's `IdentityClient`. No AWS calls.
import { assertEquals, assertThrows } from "@std/assert";
import { toUserIdentifier, type UserIdentifierInput } from "./identity.ts";

Deno.test("toUserIdentifier maps a user token to the userToken union member", () => {
  assertEquals(toUserIdentifier({ userToken: "eyJhbGci..." }), { userToken: "eyJhbGci..." });
});

Deno.test("toUserIdentifier maps a user id to the userId union member", () => {
  assertEquals(toUserIdentifier({ userId: "travel_user_001" }), { userId: "travel_user_001" });
});

Deno.test("toUserIdentifier prefers userId when both are present, as the Python isinstance order does", () => {
  const both = { userId: "travel_user_001", userToken: "eyJhbGci..." } as UserIdentifierInput;
  assertEquals(toUserIdentifier(both), { userId: "travel_user_001" });
});

Deno.test("toUserIdentifier rejects an identifier carrying neither field", () => {
  assertThrows(
    () => toUserIdentifier({} as UserIdentifierInput),
    Error,
    "Unexpected UserIdentifier",
  );
});
