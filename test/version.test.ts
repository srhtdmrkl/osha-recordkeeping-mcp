/**
 * Test suite pinning `SERVER_INFO` to package.json.
 *
 * SERVER_INFO cannot import package.json — tsconfig sets rootDir to src/, and a
 * bundled worker has no filesystem to read it from at runtime. So the constant
 * is duplicated, and this test is what stops the copy from drifting: clients see
 * SERVER_INFO.version over the wire, and a stale one misreports which build
 * produced a determination.
 */
import { readFileSync } from "node:fs";
import { SERVER_INFO } from "../src/server.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { name: string; version: string };

describe("server identity", () => {
  test("SERVER_INFO.version matches package.json", () => {
    expect(SERVER_INFO.version).toBe(pkg.version);
  });

  test("SERVER_INFO.name matches package.json", () => {
    expect(SERVER_INFO.name).toBe(pkg.name);
  });
});
