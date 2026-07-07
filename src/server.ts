import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_GUIDE } from "./guide.js";
import { checkPoster, createPoster, generatePoster, refinePoster, ToolContext } from "./tools.js";

export const SERVER_NAME = "ridvay";
export const SERVER_VERSION = "0.1.0";

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "get_design_guide",
    {
      title: "Get the Ridvay design-authoring guide",
      description:
        "START HERE for posters: returns the Ridvay design IR format (JSON contract, " +
        "element types, fonts, backgrounds, worked example) so YOU can compose the design " +
        "yourself and save it with create_poster — the fast, free, full-control path. " +
        "Call once before your first create_poster.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: DESIGN_GUIDE }] }),
  );

  server.registerTool(
    "create_poster",
    {
      title: "Create a poster from your own design (preferred)",
      description:
        "PREFERRED way to make a poster/flyer/social post: YOU (the assistant) compose " +
        "the design as Ridvay design IR — every element, color, and font is your call; " +
        "Ridvay only stores, renders, and shares it. Fast and free (no AI generation " +
        "credits). Call get_design_guide once for the IR format, then submit here. " +
        "Returns view/share/edit links. Fall back to generate_poster only if you cannot " +
        "compose the design yourself.",
      inputSchema: {
        design: z
          .object({})
          .passthrough()
          .describe(
            "The full design IR document (see get_design_guide): " +
              '{ version, type: "design", title, pages: [{ width, height, background, elements }] }.',
          ),
        share: z
          .boolean()
          .optional()
          .describe(
            "Create an unlisted public share link (/d/…). Default true; set false to " +
              "keep the design private to the account.",
          ),
      },
    },
    async (args) => runTool(() => createPoster(ctx, { design: args.design, share: args.share })),
  );

  server.registerTool(
    "generate_poster",
    {
      title: "Generate a poster with Ridvay's AI (fallback)",
      description:
        "FALLBACK: have Ridvay's own AI design a poster from a text brief. Slower (20–40s) " +
        "and consumes the account's generation credits. PREFER designing it yourself with " +
        "get_design_guide + create_poster — that path is faster, free, and gives you full " +
        "creative control. Use this only when you cannot compose the design yourself.",
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
        "Requires the design ID returned by create_poster or generate_poster.",
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
