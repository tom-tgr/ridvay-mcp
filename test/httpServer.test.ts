import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpHttpServer } from "../src/httpServer.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createMcpHttpServer({ publicUrl: "https://mcp.ridvay.com", apiUrl: "https://api.example.com" });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/** Streamable-HTTP POST helper (clients must accept both JSON and SSE). */
async function mcpPost(body: unknown, bearer?: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
};

describe("remote MCP http server", () => {
  it("serves health under both spellings (GFE swallows /healthz on run.app)", async () => {
    for (const p of ["/healthz", "/health"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, transport: "streamable-http" });
    }
  });

  it("serves RFC 9728 protected-resource metadata naming the API as authorization server", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.resource).toBe("https://mcp.ridvay.com");
    expect(doc.authorization_servers).toEqual(["https://api.example.com"]);
  });

  it("401s a bearer-less MCP request WITH the OAuth discovery pointer", async () => {
    const res = await mcpPost(INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.ridvay.com/.well-known/oauth-protected-resource"',
    );
  });

  it("initializes an MCP session with a bearer (per-request, stateless)", async () => {
    const res = await mcpPost(INITIALIZE, "sk-ridvay-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result?.serverInfo?.name).toBe("ridvay");
    expect(body.result?.protocolVersion).toBeTruthy();
  });

  it("lists all 9 tools over HTTP without touching the Ridvay API", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "sk-ridvay-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = (body.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      [
        "animate_poster",
        "check_export",
        "check_poster",
        "create_poster",
        "export_poster",
        "export_video",
        "generate_poster",
        "get_design_guide",
        "refine_poster",
      ].sort(),
    );
  });

  it("rejects non-POST on the MCP endpoint (stateless: no stream, no session)", async () => {
    const res = await fetch(`${base}/mcp`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("404s unknown paths", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
