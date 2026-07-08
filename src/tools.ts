/**
 * Tool handlers, kept free of MCP SDK types so they can be unit-tested
 * against a plain client. server.ts adapts them onto the MCP server.
 */
import {
  countPendingImages,
  DesignIr,
  GenerateDesignResponse,
  RidvayClient,
} from "./ridvayClient.js";
import { editUrl, viewUrl } from "./links.js";

export interface ToolContext {
  client: RidvayClient;
  webUrl?: string;
}

export interface GeneratePosterArgs {
  prompt: string;
  size?: string;
  use_brand?: boolean;
  share?: boolean;
  /** Model id of the calling agent (e.g. "claude-fable-5"), for attribution. */
  agent_model?: string;
}

export interface RefinePosterArgs {
  design_id: string;
  instruction: string;
  use_brand?: boolean;
  agent_model?: string;
}

export interface CheckPosterArgs {
  design_id: string;
}

export interface CreatePosterArgs {
  design: Record<string, unknown>;
  share?: boolean;
  agent_model?: string;
}

export async function generatePoster(ctx: ToolContext, args: GeneratePosterArgs): Promise<string> {
  const res = await ctx.client.generateDesign({
    prompt: args.prompt,
    size: args.size,
    useBrand: args.use_brand,
    deferImages: true,
    agentModel: args.agent_model,
  });
  const shared = args.share === false ? false : await tryShare(ctx, res.designId);
  return describeDesignResult(ctx, res, { justGenerated: true, shared });
}

/**
 * Self-drive mode: the calling assistant authored the IR itself; Ridvay only
 * persists, renders, and shares it — no Ridvay-side AI generation (and no
 * generation credits) involved.
 */
export async function createPoster(ctx: ToolContext, args: CreatePosterArgs): Promise<string> {
  const ir = { version: "1.0", type: "design", ...args.design } as DesignIr;
  const pages = ir.pages;
  if (!Array.isArray(pages) || pages.length === 0 || !Array.isArray(pages[0]?.elements)) {
    throw new Error(
      'The design must have a "pages" array with at least one page containing an "elements" ' +
        "array. Call get_design_guide for the exact IR format and a worked example.",
    );
  }

  const res = await ctx.client.createDesign(ir, undefined, { agentModel: args.agent_model });
  if (res.status !== "success" || !res.id) {
    throw new Error(`Ridvay could not save the design: ${res.error ?? `status "${res.status}"`}`);
  }

  const savedIr = res.ir ?? ir;
  const pending = countPendingImages(savedIr);
  if (pending > 0) {
    void ctx.client.resolveImages(res.id).catch(() => {});
  }

  const shared = args.share === false ? false : await tryShare(ctx, res.id);
  const title = savedIr.title ?? "Untitled design";
  const lines = [
    `Poster created from your design: "${title}" ✅`,
    `Design ID: ${res.id}`,
    ...linkLines(ctx, res.id, shared),
  ];
  if (pending > 0) {
    lines.push(
      `⏳ ${pending} image prompt(s) are rendering server-side (~1 min); links work now. Use check_poster to confirm completion.`,
    );
  }
  return lines.join("\n");
}

export async function refinePoster(ctx: ToolContext, args: RefinePosterArgs): Promise<string> {
  const res = await ctx.client.refineDesign(args.design_id, {
    prompt: args.instruction,
    useBrand: args.use_brand,
    agentModel: args.agent_model,
  });
  return describeDesignResult(ctx, res, { justGenerated: false, shared: undefined });
}

export async function checkPoster(ctx: ToolContext, args: CheckPosterArgs): Promise<string> {
  const body = await ctx.client.getDesign(args.design_id);
  const ir = extractIr(body);
  const pending = countPendingImages(ir);
  const title = ir?.title ?? (body["title"] as string | undefined) ?? "Untitled design";
  const ogImage = extractOgImage(body);
  const shared = extractIsPublic(body);

  if (pending > 0) {
    // Self-heal: if the resolve pass kicked off at generate time was lost
    // (process restart, dropped connection), checking re-triggers it.
    void ctx.client.resolveImages(args.design_id).catch(() => {});
  }

  const lines = [
    `"${title}" (design ID: ${args.design_id})`,
    pending > 0
      ? `⏳ ${pending} image(s) are still rendering server-side (render re-triggered). Check again in ~30–60 seconds.`
      : `✅ All images are rendered — the design is complete.`,
    ...linkLines(ctx, args.design_id, shared),
  ];
  if (ogImage) lines.push(`Preview image: ${ogImage}`);
  return lines.join("\n");
}

/** Sharing is best-effort: a failed share still leaves a usable design. */
async function tryShare(ctx: ToolContext, designId: string | undefined): Promise<boolean> {
  if (!designId) return false;
  try {
    await ctx.client.shareDesign(designId, true);
    return true;
  } catch {
    return false;
  }
}

function describeDesignResult(
  ctx: ToolContext,
  res: GenerateDesignResponse,
  opts: { justGenerated: boolean; shared: boolean | undefined },
): string {
  if (res.status !== "success" || !res.designId) {
    const reason = res.error ?? `unexpected status "${res.status}"`;
    throw new Error(`Ridvay could not ${opts.justGenerated ? "generate" : "update"} the design: ${reason}`);
  }

  const pending = countPendingImages(res.ir);
  if (pending > 0) {
    // Deferred-image flow: kick the server-side resolve pass without holding
    // the tool call open — the design fills in while the user reads the reply.
    void ctx.client.resolveImages(res.designId).catch(() => {});
  }

  const title = res.ir?.title ?? "Untitled design";
  const lines = [
    `${opts.justGenerated ? "Poster generated" : "Poster updated"}: "${title}" ✅`,
    `Design ID: ${res.designId}`,
    ...linkLines(ctx, res.designId, opts.shared),
  ];
  if (pending > 0) {
    lines.push(
      `⏳ ${pending} AI image(s) are rendering in the background (~1 min); the links work now and the images appear automatically. Use check_poster to confirm completion.`,
    );
  }
  if (res.usage?.model) {
    lines.push(`(model: ${res.usage.model}, ${Math.round((res.usage.latencyMs ?? 0) / 1000)}s)`);
  }
  return lines.join("\n");
}

/**
 * Both user-facing links go through the PUBLIC share (/d/ view, ?remix= edit),
 * so they work for any recipient regardless of login. When the design isn't
 * shared, neither public link resolves — say so plainly rather than hand out a
 * URL that 404s (there is no reliable browser link to a private MCP design,
 * since ?open= needs the viewer to be logged into the owning account).
 */
function linkLines(ctx: ToolContext, designId: string, shared: boolean | undefined): string[] {
  if (shared === false) {
    return [
      `Design ID ${designId} is private — not shared, so it has no public link.`,
      "Pass share: true to get view/edit links anyone can open.",
    ];
  }
  return [
    `View & share: ${viewUrl(designId, { webUrl: ctx.webUrl })}`,
    `Open in Ridvay Studio to edit: ${editUrl(designId, { webUrl: ctx.webUrl })}`,
  ];
}

export interface ExportPosterArgs {
  design_id: string;
  format?: "png" | "jpeg";
  scale?: number;
  quality?: number;
  page?: number;
}

export async function exportPoster(ctx: ToolContext, args: ExportPosterArgs): Promise<string> {
  const res = await ctx.client.renderImage(args.design_id, {
    format: args.format,
    scale: args.scale,
    quality: args.quality,
    pageIndex: args.page,
  });
  if (!res.imageUrl) {
    throw new Error(
      `Ridvay could not export the design: ${res.error ?? "no image URL returned"}. ` +
        "If images are still rendering, run check_poster first.",
    );
  }
  const fmt = (args.format ?? "png").toUpperCase();
  const scale = args.scale ?? 2;
  return [
    `Exported "${args.design_id}" as ${fmt} (${scale}× the design's native size):`,
    res.imageUrl,
    "The image is at the design's own pixel dimensions × scale — download it directly.",
  ].join("\n");
}

export interface AnimatePosterArgs {
  design_id: string;
  description?: string;
}

export async function animatePoster(ctx: ToolContext, args: AnimatePosterArgs): Promise<string> {
  const res = await ctx.client.animateDesign(args.design_id, { description: args.description });
  if (res.status !== "success" || !res.designId) {
    throw new Error(`Ridvay could not animate the design: ${res.error ?? `status "${res.status}"`}`);
  }
  return [
    `Motion added to "${res.ir?.title ?? args.design_id}" ✅`,
    args.description
      ? `Applied your motion direction: "${args.description}".`
      : "Applied a tasteful default animation (staggered entrances, morphing between pages).",
    `Preview it in Studio: ${editUrl(res.designId, { webUrl: ctx.webUrl })}`,
    "Use export_video to render it to an MP4.",
  ].join("\n");
}

export interface ExportVideoArgs {
  design_id: string;
  fps?: number;
  audio_url?: string;
}

export async function exportVideo(ctx: ToolContext, args: ExportVideoArgs): Promise<string> {
  // render-video takes raw IR (not an id), so fetch the saved design first.
  const body = await ctx.client.getDesign(args.design_id);
  const ir = extractIr(body);
  if (!ir) throw new Error(`Could not load design "${args.design_id}" to render a video.`);

  const res = await ctx.client.renderVideo(ir, { fps: args.fps, audioUrl: args.audio_url });
  if (!res.videoUrl) {
    throw new Error(
      `Ridvay could not render the video: ${res.error ?? "no video URL returned"}. ` +
        "The design needs motion first — run animate_poster (or include motion fields in the design).",
    );
  }
  return [`Rendered "${args.design_id}" to an MP4 video:`, res.videoUrl].join("\n");
}

function extractIr(body: Record<string, unknown>): DesignIr | undefined {
  if (body["ir"] && typeof body["ir"] === "object") return body["ir"] as DesignIr;
  const data = body["data"];
  if (data && typeof data === "object" && (data as Record<string, unknown>)["ir"]) {
    return (data as Record<string, unknown>)["ir"] as DesignIr;
  }
  return undefined;
}

function extractOgImage(body: Record<string, unknown>): string | undefined {
  const direct = body["ogImage"];
  if (typeof direct === "string" && direct.startsWith("https://")) return direct;
  const data = body["data"];
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>)["ogImage"];
    if (typeof nested === "string" && nested.startsWith("https://")) return nested;
  }
  return undefined;
}

function extractIsPublic(body: Record<string, unknown>): boolean | undefined {
  const direct = body["isPublic"];
  if (typeof direct === "boolean") return direct;
  const data = body["data"];
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>)["isPublic"];
    if (typeof nested === "boolean") return nested;
  }
  return undefined;
}
