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
import { editUrl, remixUrl, viewUrl } from "./links.js";

export interface ToolContext {
  client: RidvayClient;
  webUrl?: string;
}

export interface GeneratePosterArgs {
  prompt: string;
  size?: string;
  use_brand?: boolean;
  share?: boolean;
}

export interface RefinePosterArgs {
  design_id: string;
  instruction: string;
  use_brand?: boolean;
}

export interface CheckPosterArgs {
  design_id: string;
}

export async function generatePoster(ctx: ToolContext, args: GeneratePosterArgs): Promise<string> {
  const res = await ctx.client.generateDesign({
    prompt: args.prompt,
    size: args.size,
    useBrand: args.use_brand,
    deferImages: true,
  });
  const shared = args.share === false ? false : await tryShare(ctx, res.designId);
  return describeDesignResult(ctx, res, { justGenerated: true, shared });
}

export async function refinePoster(ctx: ToolContext, args: RefinePosterArgs): Promise<string> {
  const res = await ctx.client.refineDesign(args.design_id, {
    prompt: args.instruction,
    useBrand: args.use_brand,
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
 * shared === false → only the owner link is valid, so don't hand out /d/ URLs
 * that would redirect. undefined (unknown) keeps all links, which matches the
 * default generate flow where sharing is on.
 */
function linkLines(ctx: ToolContext, designId: string, shared: boolean | undefined): string[] {
  const edit = `Edit in Ridvay Studio: ${editUrl(designId, { webUrl: ctx.webUrl })}`;
  if (shared === false) {
    return [edit, "(private — pass share: true when generating to get a shareable link)"];
  }
  return [
    `View / share: ${viewUrl(designId, { webUrl: ctx.webUrl })}`,
    edit,
    `Editable copy for others: ${remixUrl(designId, { webUrl: ctx.webUrl })}`,
  ];
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
