# ridvay-mcp

MCP (Model Context Protocol) server that lets AI assistants — Claude Code, Claude Desktop,
GitHub Copilot (VS Code agent mode), Cursor, and any other MCP client — generate and edit
**Ridvay Studio** posters, flyers, and social designs from a chat prompt.

The server is a thin stdio wrapper over the Ridvay API (`/v1/Designs`): it generates with
deferred images for fast responses (~10–30 s), kicks the server-side image render in the
background, creates an unlisted share link, and hands back view/edit URLs.

## Tools

| Tool | What it does |
|------|--------------|
| `generate_poster` | Generate a design from a text brief (`prompt`, optional `size`, `use_brand`, `share`). Returns `/d/{id}` share link + Studio edit links. |
| `refine_poster` | Natural-language edit of an existing design (`design_id`, `instruction`). |
| `check_poster` | Report whether a design's AI images finished rendering (re-triggers the render if it was lost) and return its links. |

`size` accepts `1080x1080` (default), `1080x1920` / `story`, `1080x1350`, `1920x1080`,
`a4`, `slide`, or any `WxH`.

## Build

```bash
npm install
npm run build     # emits dist/
npm test          # vitest unit suite
```

## Environment

| Var | Required | Meaning |
|-----|----------|---------|
| `RIDVAY_API_KEY` | yes | Ridvay API key (`sk-ridvay-…`). |
| `RIDVAY_SUB_USER_ID` | no | With an admin/platform key: the Ridvay user ID that should own generated designs (they appear in that account's *My designs*). |
| `RIDVAY_API_URL` | no | Default `https://api.ridvay.com`. |
| `RIDVAY_WEB_URL` | no | Base for returned links, default `https://ridvay.com`. |

## Hook it up

**Claude Code**

```bash
claude mcp add --scope user ridvay --env RIDVAY_API_KEY=sk-ridvay-… \
  -- node /Users/tomsgruzins/ridvay-repo/ridvay-mcp/dist/index.js
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ridvay": {
      "command": "node",
      "args": ["/Users/tomsgruzins/ridvay-repo/ridvay-mcp/dist/index.js"],
      "env": { "RIDVAY_API_KEY": "sk-ridvay-…" }
    }
  }
}
```

**VS Code / GitHub Copilot agent mode** — user `mcp.json`
(`~/Library/Application Support/Code/User/mcp.json`), then enable the server from the
Copilot Chat tools picker:

```json
{
  "servers": {
    "ridvay": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/tomsgruzins/ridvay-repo/ridvay-mcp/dist/index.js"],
      "env": { "RIDVAY_API_KEY": "sk-ridvay-…" }
    }
  }
}
```

## Behavior notes

- **Sharing:** `generate_poster` creates an unlisted public share link by default so the
  chat reply contains a working `/d/{id}` URL. Pass `share: false` to keep a design
  private to the owning account (only the Studio `?open=` link is returned).
- **Deferred images:** generation returns as soon as the layout is ready; AI/stock images
  render server-side in the background (~1 min). `check_poster` reports and, if needed,
  re-triggers that pass.
- **Account ownership:** with the platform key and no `RIDVAY_SUB_USER_ID`, designs belong
  to the platform account — the share/remix links still work for everyone.
