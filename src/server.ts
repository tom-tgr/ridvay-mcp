import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_GUIDE } from "./guide.js";
import { attachClientTelemetry } from "./telemetry.js";
import {
  animatePoster,
  checkExport,
  checkPoster,
  createPoster,
  exportPoster,
  exportVideo,
  generatePoster,
  refinePoster,
  ToolContext,
} from "./tools.js";

export const SERVER_NAME = "ridvay";
export const SERVER_VERSION = "0.3.0";

const AGENT_MODEL_SCHEMA = z
  .string()
  .optional()
  .describe(
    'The model id of the agent making this call (e.g. "claude-fable-5"). ' +
      "Used for quality attribution.",
  );

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  // Forward the connected MCP client's identity on every Ridvay API request.
  attachClientTelemetry(server, ctx.client);

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
        agent_model: AGENT_MODEL_SCHEMA,
      },
    },
    async (args) =>
      runTool(() =>
        createPoster(ctx, { design: args.design, share: args.share, agent_model: args.agent_model }),
      ),
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
        agent_model: AGENT_MODEL_SCHEMA,
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
        agent_model: AGENT_MODEL_SCHEMA,
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

  server.registerTool(
    "export_poster",
    {
      title: "Export a poster as a PNG/JPEG image",
      description:
        "Render a saved design to a downloadable image file at its native pixel size. Use this to " +
        "get the actual poster image (not the share page) — e.g. a 1080×1350 PNG. Usually returns " +
        "the URL directly; for slow renders it returns a job ID to poll with check_export. If the " +
        "design has AI images still rendering, run check_poster first.",
      inputSchema: {
        design_id: z.string().min(1).describe("The design ID returned by create_poster/generate_poster."),
        format: z
          .enum(["png", "jpeg"])
          .optional()
          .describe('"png" (default, lossless, transparent-capable) or "jpeg" (smaller).'),
        scale: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("Pixel scale of the design's native size. 1 = exact size, 2 = crisp/retina (default), up to 4."),
        quality: z.number().int().min(1).max(100).optional().describe("JPEG quality 1–100 (ignored for PNG)."),
        page: z.number().int().min(0).optional().describe("Page index for multi-page designs (0-based, default 0)."),
      },
    },
    async (args) => runTool(() => exportPoster(ctx, args)),
  );

  server.registerTool(
    "animate_poster",
    {
      title: "Add animation / motion to a poster",
      description:
        "Turn a static design into an animated one — entrance/exit animations, per-page transitions, " +
        "and morphing between pages. Leave the description blank for a tasteful default, or describe the " +
        "motion you want. Then use export_video to render it to an MP4.",
      inputSchema: {
        design_id: z.string().min(1).describe("The design ID to animate."),
        description: z
          .string()
          .optional()
          .describe('Optional motion direction, e.g. "headline types on, logo pops, gentle fades". Blank → default.'),
      },
    },
    async (args) => runTool(() => animatePoster(ctx, args)),
  );

  server.registerTool(
    "export_video",
    {
      title: "Render an animated poster to MP4 video",
      description:
        "Render a design's animation timeline to a downloadable H.264 MP4. The design must have motion " +
        "already (from animate_poster, or motion fields in create_poster). Optionally loop a soundtrack " +
        "under it. Video renders take minutes, so this returns a job ID — poll it with check_export.",
      inputSchema: {
        design_id: z.string().min(1).describe("The design ID to render (must be animated)."),
        fps: z.number().int().min(1).max(60).optional().describe("Frames per second (default 30, max 60)."),
        audio_url: z
          .string()
          .optional()
          .describe("Optional https URL of a soundtrack to loop under the clip (muxed as AAC)."),
      },
    },
    async (args) => runTool(() => exportVideo(ctx, args)),
  );

  server.registerTool(
    "check_export",
    {
      title: "Check an export job's status",
      description:
        "Poll an async export started by export_poster or export_video. Returns the download URL when " +
        "the render is done, or the failure reason. Images finish in seconds; videos take minutes.",
      inputSchema: {
        job_id: z.string().min(1).describe("The job ID returned by export_poster/export_video."),
      },
    },
    async (args) => runTool(() => checkExport(ctx, args)),
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
