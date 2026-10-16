import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

describe("DSH Integration", () => {
  it("should have valid package.json with dsh config", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    expect(pkg.name).toBe("dsh-llm-router");
    expect(pkg.dsh).toBeDefined();
    expect(pkg.dsh.bundle.patch).toBe("./cordis.patch.yml");
  });

  it("should have client bundle for settings UI", () => {
    expect(existsSync(resolve(root, "dist/client/index.js"))).toBe(true);
    const clientCode = readFileSync(resolve(root, "dist/client/index.js"), "utf-8");
    expect(clientCode).toContain("__ModuleLoader__");
    expect(clientCode).toContain("settings.plugins.tab");
  });

  it("should have cordis.patch.yml", () => {
    expect(existsSync(resolve(root, "cordis.patch.yml"))).toBe(true);
    const patch = readFileSync(resolve(root, "cordis.patch.yml"), "utf-8");
    expect(patch).toContain("dsh-llm-router");
    expect(patch).toContain("defaultGroup");
  });

  it("should export apply function and Config schema", async () => {
    const mod = await import("../src/index");
    expect(mod.name).toBe("dsh-llm-router");
    expect(mod.inject).toContain("llm");
    expect(mod.Config).toBeDefined();
    expect(typeof mod.apply).toBe("function");
  });

  it("should use adapter registration + prepareCall delegation", async () => {
    const indexCode = readFileSync(resolve(root, "src/index.ts"), "utf-8");
    expect(indexCode).toContain("registerAdapter");
    // Registered as the "auto" provider (was: stale 'Registered as provider: auto' log check)
    expect(indexCode).toContain('registerAdapter(["auto"]');

    const routerCode = readFileSync(resolve(root, "src/router.ts"), "utf-8");
    // prepareCall delegation (参考 dsh-smart-router)
    expect(routerCode).toContain("prepareCall");
    expect(routerCode).toContain("prepared.stream(forwarded)");
    expect(routerCode).toContain("prepared.config.provider");
  });

  it("should strip config fields and rebuild from prepared.config", async () => {
    const routerCode = readFileSync(resolve(root, "src/router.ts"), "utf-8");
    expect(routerCode).toContain("reasoningEffort: _re");
    expect(routerCode).toContain("maxTokens: _mt");
    expect(routerCode).toContain("temperature: _t");
    expect(routerCode).toContain("stop: _s");
  });
});
