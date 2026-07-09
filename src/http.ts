#!/usr/bin/env node
/**
 * ridvay-mcp over streamable HTTP — remote-MCP entrypoint (mcp.ridvay.com).
 * All logic lives in httpServer.ts (unit-tested); this file only reads env and listens.
 *
 * Environment:
 *   PORT             (optional) listen port, default 8080 (Cloud Run convention)
 *   RIDVAY_PUBLIC_URL(optional) public origin of this service, default https://mcp.ridvay.com
 *   RIDVAY_API_URL   (optional) API base URL, default https://api.ridvay.com
 *   RIDVAY_WEB_URL   (optional) website base URL for links, default https://ridvay.com
 *
 * NOTE: no RIDVAY_API_KEY here — auth is per-request (Authorization: Bearer sk-ridvay-…).
 */
import { createMcpHttpServer } from "./httpServer.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";

const port = Number(process.env.PORT || 8080);
const server = createMcpHttpServer({
  publicUrl: process.env.RIDVAY_PUBLIC_URL,
  apiUrl: process.env.RIDVAY_API_URL,
  webUrl: process.env.RIDVAY_WEB_URL,
});

server.listen(port, () => {
  console.error(`${SERVER_NAME} MCP server v${SERVER_VERSION} ready (streamable HTTP on :${port})`);
});
