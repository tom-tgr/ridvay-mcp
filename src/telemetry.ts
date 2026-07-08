/**
 * Attribution telemetry: identifies which MCP client (initialize-handshake
 * clientInfo) and which agent model produced a design, so the API can segment
 * output quality by source. Consumed API-side via two HTTP headers:
 *   X-Ridvay-Client       — "claude-code/2.1.0" (MCP clientInfo name/version)
 *   X-Ridvay-Agent-Model  — the calling agent's model id (tool arg agent_model)
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RidvayClient } from "./ridvayClient.js";

export const CLIENT_HEADER = "X-Ridvay-Client";
export const AGENT_MODEL_HEADER = "X-Ridvay-Agent-Model";

/**
 * HTTP header values must be printable ASCII on one line; fetch throws on
 * anything else. Collapse the rest to spaces and cap the length.
 */
export function sanitizeHeaderValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value
    .replace(/[^\x20-\x7e]+/g, " ")
    .trim()
    .slice(0, 200);
  return clean || undefined;
}

/**
 * Formats MCP clientInfo as "name/version" (e.g. "claude-code/2.1.0").
 * Returns undefined when the client never identified itself.
 */
export function formatClientInfo(
  info: { name?: string; version?: string } | undefined,
): string | undefined {
  const name = sanitizeHeaderValue(info?.name);
  if (!name) return undefined;
  const version = sanitizeHeaderValue(info?.version);
  return version ? `${name}/${version}` : name;
}

/**
 * Wires the MCP initialize handshake's clientInfo into every Ridvay API
 * request. Read lazily per request because clientInfo only exists after the
 * handshake completes, which is long after the client is constructed.
 */
export function attachClientTelemetry(server: McpServer, client: RidvayClient): void {
  client.setClientInfoProvider(() => formatClientInfo(server.server.getClientVersion()));
}
