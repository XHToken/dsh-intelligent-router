import { describe, it, expect } from "vitest";
// scripts/compatibility.mjs has no type declarations; the doctor CLI and
// these tests are its only consumers.
// @ts-expect-error untyped ESM helper module
import { validatePolicy, policy } from "../scripts/compatibility.mjs";

function base() {
  return {
    schemaVersion: 1,
    recommendedHost: "0.2.0-rc.2",
    previewTag: "next",
    supportedHosts: [{ version: "0.2.0-rc.2", track: "recommended" }],
  };
}

describe("validatePolicy", () => {
  it("accepts the shipped compatibility.json and returns the allowed host list", () => {
    expect(validatePolicy(policy)).toEqual(["0.2.0-rc.2"]);
  });

  it("accepts a multi-track policy and preserves declaration order", () => {
    const input = {
      ...base(),
      supportedHosts: [
        { version: "0.2.0-rc.2", track: "recommended" },
        { version: "0.1.7-rc.2", track: "legacy" },
        { version: "0.2.1-alpha.1", track: "preview" },
      ],
    };
    expect(validatePolicy(input)).toEqual(["0.2.0-rc.2", "0.1.7-rc.2", "0.2.1-alpha.1"]);
  });

  it.each([
    [{ schemaVersion: 2 }, "schemaVersion"],
    [{ previewTag: "latest" }, "previewTag"],
    [{ supportedHosts: [] }, "empty supportedHosts"],
    [{ supportedHosts: "nope" }, "non-array supportedHosts"],
  ])("rejects malformed policy (%s)", (override) => {
    expect(() => validatePolicy({ ...base(), ...override })).toThrow();
  });

  it("requires exactly one recommended track", () => {
    const twoRecommended = {
      ...base(),
      supportedHosts: [
        { version: "0.2.0-rc.2", track: "recommended" },
        { version: "0.2.1-rc.1", track: "recommended" },
      ],
    };
    expect(() => validatePolicy(twoRecommended)).toThrow(/recommended/);
    const noneRecommended = {
      ...base(),
      supportedHosts: [{ version: "0.2.0-rc.2", track: "legacy" }],
    };
    expect(() => validatePolicy(noneRecommended)).toThrow(/recommended/);
  });

  it("requires recommendedHost to match the single recommended entry", () => {
    expect(() => validatePolicy({ ...base(), recommendedHost: "9.9.9" })).toThrow(/recommended/);
  });

  it("rejects alpha/beta hosts as the ordinary-user recommendation", () => {
    const input = {
      schemaVersion: 1,
      recommendedHost: "0.2.1-alpha.1",
      previewTag: "next",
      supportedHosts: [{ version: "0.2.1-alpha.1", track: "recommended" }],
    };
    expect(() => validatePolicy(input)).toThrow(/[Aa]lpha|beta/);
  });

  it.each([
    ["0.2.0", "missing patch"],
    ["0.2.0-rc", "missing rc number"],
    ["0.2.0-rc.2 ", "trailing whitespace"],
    ["v0.2.0-rc.2", "leading v"],
  ])("rejects version format violations (%s)", (version) => {
    expect(() =>
      validatePolicy({ ...base(), supportedHosts: [{ version, track: "recommended" }] })
    ).toThrow();
  });

  it("rejects duplicate host versions and unknown tracks", () => {
    const dup = {
      ...base(),
      supportedHosts: [
        { version: "0.2.0-rc.2", track: "recommended" },
        { version: "0.2.0-rc.2", track: "legacy" },
      ],
    };
    expect(() => validatePolicy(dup)).toThrow();
    const badTrack = {
      ...base(),
      supportedHosts: [{ version: "0.2.0-rc.2", track: "canary" }],
    };
    expect(() => validatePolicy(badTrack)).toThrow();
  });

  describe("sourceCandidates", () => {
    const candidate = {
      version: "0.2.1-rc.3",
      repository: "https://github.com/deepseek-ai/deepseek-harness",
      commit: "a".repeat(40),
      evidence: "docs/e2e-run.md",
    };

    it("accepts a well-formed source candidate", () => {
      expect(validatePolicy({ ...base(), sourceCandidates: [candidate] })).toEqual(["0.2.0-rc.2"]);
    });

    it.each([
      [{ commit: "abc123" }, "short commit"],
      [{ evidence: "notes/e2e.md" }, "evidence outside docs/"],
      [{ repository: "https://github.com/someone/fork" }, "unofficial repository"],
      [{ version: "0.2.0-rc.2" }, "version already in supportedHosts"],
    ])("rejects malformed source candidates (%s)", (override) => {
      expect(() =>
        validatePolicy({ ...base(), sourceCandidates: [{ ...candidate, ...override }] })
      ).toThrow();
    });
  });
});
