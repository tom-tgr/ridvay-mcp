import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkPoster, generatePoster, refinePoster, ToolContext } from "./tools.js";

export const SERVER_NAME = "ridvay";
export const SERVER_VERSION = "0.1.0";

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "generate_poster",
    {
      title: "Generate a poster with Ridvay Studio",
      description:
        "Generate a poster, flyer, social-media post, story, banner, or any graphic design " +
        "from a text brief using Ridvay Studio's AI design engine. Returns links to view, " +
        "share, and edit the design. Describe the content, occasion, style, and any text " +
        "that must appear. Typical run time is 20–40 seconds.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe(
            "The design brief: what the poster is for, the exact text/wording to include, " +
              "desired mood/style/colors. More detail gives better results.",
          ),
        size: z
          .string()
          .optional()
          .describe(
            'Canvas size hint. Accepts "1080x1080" (square post, default), "1080x1920" or ' +
              '"story" (vertical story), "1080x1350" (portrait post), "1920x1080" (landscape), ' +
              '"a4" (print poster), "slide" (presentation).',
          ),
        use_brand: z
          .boolean()
          .optional()
          .describe("Apply the account's Brand Kit (colors, fonts, logo). Default false."),
        share: z
          .boolean()
          .optional()
          .describe(
            "Create an unlisted public share link (/d/…) for the poster. Default true; " +
              "set false to keep the design private to the account.",
          ),
      },
    },
    async (args) => runTool(() => generatePoster(ctx, args)),
  );

  server.registerTool(
    "refine_poster",
    {
      title: "Refine an existing poster",
      description:
        "Edit a previously generated Ridvay design with a natural-language instruction " +
        '(e.g. "make the headline red", "add our opening hours", "swap to a dark theme"). ' +
        "Requires the design ID returned by generate_poster.",
      inputSchema: {
        design_id: z.string().min(1).describe("The design ID returned by generate_poster."),
        instruction: z.string().min(1).describe("What to change, in plain language."),
        use_brand: z
          .boolean()
          .optional()
          .describe("Re-apply the account's Brand Kit while editing. Default false."),
      },
    },
    async (args) => runTool(() => refinePoster(ctx, args)),
  );

  server.registerTool(
    "check_poster",
    {
      title: "Check a poster's status",
      description:
        "Check whether a generated Ridvay design has finished rendering its AI images, " +
        "and get its view/edit links again. Use after generate_poster reports images " +
        "still rendering.",
      inputSchema: {
        design_id: z.string().min(1).describe("The design ID returned by generate_poster."),
      },
    },
    async (args) => runTool(() => checkPoster(ctx, args)),
  );

  return server;
}

async function runTool(
  fn: () => Promise<string>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const text = await fn();
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}
