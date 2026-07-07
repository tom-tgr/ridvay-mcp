#!/usr/bin/env node
/**
 * ridvay-mcp — MCP server exposing Ridvay Studio poster generation.
 * stdio transport; stdout is reserved for JSON-RPC, so all logging goes to stderr.
 *
 * Environment:
 *   RIDVAY_API_KEY      (required) Ridvay API key ("sk-ridvay-…")
 *   RIDVAY_API_URL      (optional) API base URL, default https://api.ridvay.com
 *   RIDVAY_WEB_URL      (optional) website base URL for links, default https://ridvay.com
 *   RIDVAY_SUB_USER_ID  (optional) user ID designs should belong to (admin/platform keys only)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RidvayClient } from "./ridvayClient.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const apiKey = process.env.RIDVAY_API_KEY;
  if (!apiKey) {
    console.error(
      "ridvay-mcp: RIDVAY_API_KEY environment variable is required. " +
        "Set it in your MCP client's server config.",
    );
    process.exit(1);
  }

  const client = new RidvayClient({
    baseUrl: process.env.RIDVAY_API_URL ?? "https://api.ridvay.com",
    apiKey,
    subUserId: process.env.RIDVAY_SUB_USER_ID || undefined,
  });

  const server = buildServer({ client, webUrl: process.env.RIDVAY_WEB_URL });
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} MCP server v${SERVER_VERSION} ready (stdio)`);
}

main().catch((err) => {
  console.error("ridvay-mcp fatal:", err);
  process.exit(1);
});
