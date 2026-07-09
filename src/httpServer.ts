/**
 * Remote MCP over streamable HTTP — the mcp.ridvay.com entrypoint logic.
 *
 * Design:
 * - STATELESS transport (no session ids): every POST builds a fresh McpServer + transport, handles
 *   the one request, and tears down. Cloud Run scales horizontally with zero sticky-session pain,
 *   and the Ridvay tools are single-shot HTTP calls anyway.
 * - Auth is per-request: `Authorization: Bearer sk-ridvay-…` (a real Ridvay API key — exactly what
 *   the OAuth token endpoint mints, see REMOTE-MCP-PLAN.md). The service holds NO key of its own;
 *   a missing/blank bearer gets 401 + WWW-Authenticate pointing at the protected-resource metadata,
 *   which is what triggers an MCP client's OAuth flow.
 * - `/.well-known/oauth-protected-resource` (RFC 9728) names api.ridvay.com as the authorization
 *   server. Serving it before the AS exists is harmless — clients only chase it after a 401.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RidvayClient } from "./ridvayClient.js";
import { buildServer } from "./server.js";

export interface HttpServerOptions {
  /** Public origin of THIS service, used in the protected-resource metadata. */
  publicUrl?: string;
  /** Ridvay API base (also the OAuth authorization server). */
  apiUrl?: string;
  /** Website base for links in tool replies. */
  webUrl?: string;
}

const DEFAULT_PUBLIC_URL = "https://mcp.ridvay.com";
const DEFAULT_API_URL = "https://api.ridvay.com";

export function createMcpHttpServer(options: HttpServerOptions = {}): Server {
  const publicUrl = (options.publicUrl ?? DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");

  return createServer((req, res) => {
    void route(req, res, { publicUrl, apiUrl, webUrl: options.webUrl }).catch((err) => {
      // Never let a handler crash the process; surface a JSON-RPC-ish 500 instead.
      console.error("ridvay-mcp http error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
      } else {
        res.end();
      }
    });
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { publicUrl: string; apiUrl: string; webUrl?: string },
): Promise<void> {
  const url = new URL(req.url ?? "/", cfg.publicUrl);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Both spellings: Google Frontend swallows /healthz on run.app (reserved path), so /health is
  // the one that works there; /healthz stays for k8s-style self-hosting conventions.
  if (req.method === "GET" && (path === "/healthz" || path === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "ridvay-mcp", transport: "streamable-http" }));
    return;
  }

  // RFC 9728 — tells OAuth-capable MCP clients where to authorize after a 401.
  if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
    res.end(
      JSON.stringify({
        resource: cfg.publicUrl,
        authorization_servers: [cfg.apiUrl],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://ridvay.com/mcp",
      }),
    );
    return;
  }

  // MCP endpoint: root or the conventional /mcp both work (clients paste either URL form).
  if (path === "/" || path === "/mcp") {
    if (req.method !== "POST") {
      // Stateless mode has no server-push stream to GET and no session to DELETE.
      res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const bearer = readBearer(req);
    if (!bearer) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        // The pointer that kicks off the client's OAuth discovery (RFC 9728 §5).
        "WWW-Authenticate": `Bearer resource_metadata="${cfg.publicUrl}/.well-known/oauth-protected-resource"`,
      });
      res.end(
        JSON.stringify({
          error: "unauthorized",
          error_description: "Provide a Ridvay API key as 'Authorization: Bearer sk-ridvay-…' (create one at https://ridvay.com/user/api-keys).",
        }),
      );
      return;
    }

    // Fresh, request-scoped server: the bearer becomes the RidvayClient's key, so every tool call
    // runs as the connected user and the existing API-side key auth does all real validation.
    const client = new RidvayClient({ baseUrl: cfg.apiUrl, apiKey: bearer });
    const server = buildServer({ client, webUrl: cfg.webUrl });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // plain JSON replies (no SSE buffering concerns on Cloud Run)
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}

function readBearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token || undefined;
}
