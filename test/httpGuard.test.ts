/**
 * Test suite for the HTTP security guard (httpGuard).
 * Validates host and origin allowlist parsing, DNS rebinding prevention,
 * loopback host handling, and JSON-RPC error payload formatting.
 */
import { checkRequest, forbiddenBody, loopbackHosts, parseAllowlist } from "../src/httpGuard.js";

const loopback = { allowedHosts: loopbackHosts(3000), allowedOrigins: null };

describe("parseAllowlist", () => {
  test("unset means unconfigured", () => {
    expect(parseAllowlist(undefined)).toBeNull();
  });

  test("empty and whitespace-only values mean unconfigured, not an empty allowlist", () => {
    // An empty allowlist that rejected everything would be a footgun: MCP_ALLOWED_HOSTS=""
    // reads as "I did not set this", not "permit nothing".
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist("  ,  ")).toBeNull();
  });

  test("splits, trims, and lowercases", () => {
    expect(parseAllowlist(" Example.COM:8080 , mcp.internal ")).toEqual([
      "example.com:8080",
      "mcp.internal",
    ]);
  });

  test("a wildcard anywhere in the list disables the check", () => {
    expect(parseAllowlist("*")).toBeNull();
    expect(parseAllowlist("example.com,*")).toBeNull();
  });
});

describe("checkRequest — host", () => {
  test("loopback names pass on the configured port", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(checkRequest(loopback, { host, origin: undefined })).toBeNull();
    }
  });

  test("host matching is case-insensitive", () => {
    expect(checkRequest(loopback, { host: "LocalHost:3000", origin: undefined })).toBeNull();
  });

  test("the rebinding case is rejected: attacker domain resolving to loopback", () => {
    // The browser sends Host: evil.example, because that is the name it dialled.
    // That header is the only thing distinguishing this from a genuine local call.
    const reason = checkRequest(loopback, { host: "evil.example", origin: undefined });
    expect(reason).toMatch(/not allowed/);
  });

  test("a different port is a different host", () => {
    expect(checkRequest(loopback, { host: "localhost:3001", origin: undefined })).toMatch(
      /not allowed/
    );
  });

  test("an absent Host header is rejected when an allowlist is configured", () => {
    expect(checkRequest(loopback, { host: undefined, origin: undefined })).toMatch(/absent/);
  });

  test("no allowlist means no host check", () => {
    const open = { allowedHosts: null, allowedOrigins: null };
    expect(checkRequest(open, { host: "anything.example", origin: undefined })).toBeNull();
  });
});

describe("checkRequest — origin", () => {
  const config = { allowedHosts: null, allowedOrigins: ["https://app.example"] };

  test("an allowed origin passes", () => {
    expect(checkRequest(config, { host: "x", origin: "https://app.example" })).toBeNull();
  });

  test("a disallowed origin is rejected", () => {
    expect(checkRequest(config, { host: "x", origin: "https://evil.example" })).toMatch(
      /Origin .* is not allowed/
    );
  });

  test("an absent Origin passes — non-browser clients do not send one", () => {
    expect(checkRequest(config, { host: "x", origin: null })).toBeNull();
  });
});

describe("forbiddenBody", () => {
  test("is a well-formed JSON-RPC error carrying the reason", () => {
    const body = forbiddenBody("Host header is not allowed.");
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toContain("Host header is not allowed.");
  });
});
