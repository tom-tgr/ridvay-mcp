import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AGENT_MODEL_HEADER,
  attachClientTelemetry,
  CLIENT_HEADER,
  formatClientInfo,
  sanitizeHeaderValue,
} from "../src/telemetry.js";
import { RidvayClient } from "../src/ridvayClient.js";
import { buildServer } from "../src/server.js";

function fakeMcpServer(clientInfo: { name: string; version: string } | undefined): McpServer {
  return { server: { getClientVersion: () => clientInfo } } as unknown as McpServer;
}

describe("header names", () => {
  it("match the API-side contract exactly", () => {
    expect(CLIENT_HEADER).toBe("X-Ridvay-Client");
    expect(AGENT_MODEL_HEADER).toBe("X-Ridvay-Agent-Model");
  });
});

describe("sanitizeHeaderValue", () => {
  it("passes plain values through", () => {
    expect(sanitizeHeaderValue("claude-fable-5")).toBe("claude-fable-5");
  });

  it("collapses newlines and non-ASCII to spaces and trims", () => {
    expect(sanitizeHeaderValue("bad\r\nvalue")).toBe("bad value");
    expect(sanitizeHeaderValue("  padded 名前  ")).toBe("padded");
  });

  it("caps overlong values", () => {
    expect(sanitizeHeaderValue("x".repeat(500))).toHaveLength(200);
  });

  it("returns undefined for empty or missing input", () => {
    expect(sanitizeHeaderValue(undefined)).toBeUndefined();
    expect(sanitizeHeaderValue("")).toBeUndefined();
    expect(sanitizeHeaderValue("\n\n")).toBeUndefined();
  });
});

describe("formatClientInfo", () => {
  it('formats name and version as "name/version"', () => {
    expect(formatClientInfo({ name: "claude-code", version: "2.1.0" })).toBe("claude-code/2.1.0");
  });

  it("falls back to the bare name when version is missing", () => {
    expect(formatClientInfo({ name: "cursor" })).toBe("cursor");
  });

  it("returns undefined when clientInfo is unavailable", () => {
    expect(formatClientInfo(undefined)).toBeUndefined();
    expect(formatClientInfo({ version: "1.0" })).toBeUndefined();
  });
});

describe("buildServer telemetry wiring", () => {
  it("installs a clientInfo provider on the Ridvay client (undefined before the handshake)", () => {
    const setClientInfoProvider = vi.fn();
    const client = { setClientInfoProvider } as unknown as RidvayClient;

    buildServer({ client });

    expect(setClientInfoProvider).toHaveBeenCalledTimes(1);
    const provider = setClientInfoProvider.mock.calls[0][0] as () => string | undefined;
    expect(provider()).toBeUndefined();
  });
});

describe("attachClientTelemetry", () => {
  it("sends X-Ridvay-Client on API requests once the handshake identified the client", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "d1" }),
    })) as unknown as typeof fetch;
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    attachClientTelemetry(fakeMcpServer({ name: "claude-code", version: "2.1.0" }), client);
    await client.getDesign("d1");

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)[CLIENT_HEADER]).toBe("claude-code/2.1.0");
  });

  it("omits the header when the client never identified itself", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "d1" }),
    })) as unknown as typeof fetch;
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    attachClientTelemetry(fakeMcpServer(undefined), client);
    await client.getDesign("d1");

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)[CLIENT_HEADER]).toBeUndefined();
  });

  it("reads clientInfo lazily, so a handshake after attach still counts", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "d1" }),
    })) as unknown as typeof fetch;
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    let info: { name: string; version: string } | undefined;
    attachClientTelemetry(
      { server: { getClientVersion: () => info } } as unknown as McpServer,
      client,
    );
    info = { name: "vscode", version: "1.101.0" };
    await client.getDesign("d1");

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)[CLIENT_HEADER]).toBe("vscode/1.101.0");
  });
});
