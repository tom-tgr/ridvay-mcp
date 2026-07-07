# ridvay-mcp

MCP (Model Context Protocol) server that lets AI assistants — Claude Code, Claude Desktop,
GitHub Copilot (VS Code agent mode), Cursor, and any other MCP client — create and edit
**[Ridvay Studio](https://ridvay.com/studio)** posters, flyers, and social designs straight
from a chat conversation.

Every design comes back as a working share link (`ridvay.com/d/…`) plus links to open and
edit it in the Studio editor.

## Tools

| Tool | What it does |
|------|--------------|
| `generate_poster` | Ridvay's AI designs from your text brief (`prompt`, optional `size`, `use_brand`, `share`). |
| `create_poster` | **Self-drive mode:** the *calling assistant* composes the design itself as Ridvay design IR — Ridvay only stores, renders, and shares it. No Ridvay-side AI generation. |
| `get_design_guide` | Returns the design-IR authoring spec (element types, backgrounds, fonts, worked example) that teaches the assistant to compose for `create_poster`. |
| `refine_poster` | Natural-language edit of an existing design (`design_id`, `instruction`). |
| `check_poster` | Report whether a design's AI images finished rendering and return its links. |

Two modes, one server: `generate_poster` delegates creativity to Ridvay's generation
pipeline; `create_poster` + `get_design_guide` make your AI client the designer and use
Ridvay as a pure save/render/share backend. Client-authored designs may still include
`prompt` image slots — Ridvay renders those server-side after creation.

`size` accepts `1080x1080` (default), `1080x1920` / `story`, `1080x1350`, `1920x1080`,
`a4`, `slide`, or any `WxH`.

## Get an API key

Sign in at [ridvay.com](https://ridvay.com) and create an API key from your account's
**API keys** page. Designs generated through MCP appear in your own *My designs*.

## Quickstart

**Claude Code**

```bash
claude mcp add --scope user ridvay --env RIDVAY_API_KEY=sk-ridvay-… -- npx -y ridvay-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ridvay": {
      "command": "npx",
      "args": ["-y", "ridvay-mcp"],
      "env": { "RIDVAY_API_KEY": "sk-ridvay-…" }
    }
  }
}
```

**VS Code / GitHub Copilot agent mode** — add to your user `mcp.json`
(Command Palette → "MCP: Open User Configuration"), then enable **ridvay** in the
Copilot Chat tools picker:

```json
{
  "servers": {
    "ridvay": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ridvay-mcp"],
      "env": { "RIDVAY_API_KEY": "sk-ridvay-…" }
    }
  }
}
```

Then ask your assistant things like:

> Generate a story-size poster for our weekend flash sale — 30% off everything, Saturday only.

## Environment

| Var | Required | Meaning |
|-----|----------|---------|
| `RIDVAY_API_KEY` | yes | Your Ridvay API key (`sk-ridvay-…`). |
| `RIDVAY_API_URL` | no | Default `https://api.ridvay.com`. |
| `RIDVAY_WEB_URL` | no | Base for returned links, default `https://ridvay.com`. |
| `RIDVAY_SUB_USER_ID` | no | Admin/platform keys only: act on behalf of a specific user. |

## Behavior notes

- **Sharing:** `generate_poster` / `create_poster` create an unlisted public share link by
  default so the chat reply contains a working `/d/{id}` URL. Pass `share: false` to keep
  a design private to your account (only the Studio edit link is returned).
- **Deferred images:** generation returns as soon as the layout is ready; AI/stock images
  render server-side in the background (~1 min). `check_poster` reports on and, if
  needed, re-triggers that pass.

## Development

```bash
npm install
npm run build     # emits dist/
npm test          # vitest unit suite
node dist/index.js  # run the stdio server directly (needs RIDVAY_API_KEY)
```

MIT © Ridvay
