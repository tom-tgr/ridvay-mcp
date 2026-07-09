/**
 * Thin HTTP client for the Ridvay API (api.ridvay.com).
 * Auth: opaque API key sent as `Authorization: Bearer <key>`.
 * Optional delegation: `X-Sub-User-Id` (honored only for admin/platform keys).
 * Attribution: `X-Ridvay-Client` (MCP clientInfo) on every request, and
 * `X-Ridvay-Agent-Model` on design-producing calls (see telemetry.ts).
 */
import { AGENT_MODEL_HEADER, CLIENT_HEADER, sanitizeHeaderValue } from "./telemetry.js";

export interface RidvayClientOptions {
  baseUrl: string;
  apiKey: string;
  subUserId?: string;
  /** Per-request timeout in ms. Deferred generates typically return in ~25s. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /**
   * Lazily resolves the calling MCP client's identity ("claude-code/2.1.0")
   * per request — clientInfo only exists after the initialize handshake.
   */
  clientInfoProvider?: () => string | undefined;
}

export interface GenerateDesignParams {
  prompt: string;
  size?: string;
  useBrand?: boolean;
  deferImages?: boolean;
  /** Model id of the agent making the call, forwarded for quality attribution. */
  agentModel?: string;
}

export interface DesignUsage {
  model?: string;
  totalTokens?: number;
  latencyMs?: number;
}

export interface GenerateDesignResponse {
  status: string;
  error?: string;
  designId?: string;
  ir?: DesignIr;
  usage?: DesignUsage;
}

export interface CreateDesignResponse {
  status: string;
  error?: string;
  id?: string;
  ir?: DesignIr;
}

export interface DesignIr {
  version?: string;
  type?: string;
  title?: string;
  pages?: DesignPage[];
  [key: string]: unknown;
}

export interface DesignPage {
  width?: number;
  height?: number;
  background?: DesignBackground;
  elements?: DesignElement[];
  [key: string]: unknown;
}

export interface DesignBackground {
  type?: string;
  /** A resolved image BACKGROUND stores its rendered URL in `url` (elements use `src`). */
  url?: string;
  src?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface DesignElement {
  id?: string;
  type?: string;
  src?: string;
  prompt?: string;
  canonicalKey?: string;
  vectorSvg?: string;
  [key: string]: unknown;
}

export class RidvayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "RidvayApiError";
  }
}

export class RidvayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly subUserId?: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private clientInfoProvider?: () => string | undefined;

  constructor(options: RidvayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.subUserId = options.subUserId;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.clientInfoProvider = options.clientInfoProvider;
  }

  /** Late binding for telemetry: the MCP server is built after this client. */
  setClientInfoProvider(provider: () => string | undefined): void {
    this.clientInfoProvider = provider;
  }

  async generateDesign(params: GenerateDesignParams): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      "/v1/Designs/generate",
      {
        prompt: params.prompt,
        size: params.size,
        useBrand: params.useBrand ?? false,
        deferImages: params.deferImages ?? true,
      },
      { agentModel: params.agentModel },
    );
  }

  async resolveImages(designId: string): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/resolve-images`,
    );
  }

  async refineDesign(
    designId: string,
    params: { prompt: string; useBrand?: boolean; agentModel?: string },
  ): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/refine`,
      { prompt: params.prompt, useBrand: params.useBrand ?? false },
      { agentModel: params.agentModel },
    );
  }

  async getDesign(designId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/v1/Designs/${encodeURIComponent(designId)}`,
    );
  }

  /**
   * Persists a client-authored IR as a NEW design (no Ridvay-side AI involved).
   * Server responds with the canonical saved IR and the new design id.
   */
  async createDesign(
    ir: DesignIr,
    previewImage?: string,
    opts: { agentModel?: string } = {},
  ): Promise<CreateDesignResponse> {
    return this.request<CreateDesignResponse>(
      "POST",
      "/v1/Designs/",
      { ir, previewImage },
      { agentModel: opts.agentModel },
    );
  }

  /** Toggles the unlisted public share link (`/d/{id}`) for a design. */
  async shareDesign(
    designId: string,
    isPublic = true,
  ): Promise<{ status?: string; isPublic?: boolean }> {
    return this.request<{ status?: string; isPublic?: boolean }>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/share`,
      { public: isPublic },
    );
  }

  /** Rasterizes a saved design to a hosted PNG/JPEG at its native page size × scale. */
  async renderImage(
    designId: string,
    params: { format?: "png" | "jpeg"; scale?: number; quality?: number; pageIndex?: number } = {},
  ): Promise<{ imageUrl?: string; error?: string }> {
    return this.request<{ imageUrl?: string; error?: string }>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/render-image`,
      {
        format: params.format,
        scale: params.scale,
        quality: params.quality,
        pageIndex: params.pageIndex,
      },
    );
  }

  /** Adds entrance/exit/morph motion to a design (blank description → tasteful default). */
  async animateDesign(
    designId: string,
    params: { description?: string } = {},
  ): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/animate`,
      { description: params.description },
    );
  }

  /** Renders an IR's animation timeline to a hosted H.264 MP4 (optional looped soundtrack). */
  async renderVideo(
    ir: DesignIr,
    params: { fps?: number; audioUrl?: string } = {},
  ): Promise<{ videoUrl?: string; error?: string }> {
    return this.request<{ videoUrl?: string; error?: string }>("POST", "/v1/Designs/render-video", {
      ir,
      fps: params.fps,
      audioUrl: params.audioUrl,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { agentModel?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.subUserId) headers["X-Sub-User-Id"] = this.subUserId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const clientInfo = sanitizeHeaderValue(this.clientInfoProvider?.());
    if (clientInfo) headers[CLIENT_HEADER] = clientInfo;
    const agentModel = sanitizeHeaderValue(opts.agentModel);
    if (agentModel) headers[AGENT_MODEL_HEADER] = agentModel;

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new RidvayApiError(describeHttpError(res.status, text), res.status, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RidvayApiError(`Ridvay API returned non-JSON response for ${path}`, res.status, text);
    }
  }
}

function describeHttpError(status: number, body: string): string {
  if (status === 401) {
    return "Ridvay API rejected the API key (401). Check the RIDVAY_API_KEY environment variable.";
  }
  if (status === 402) {
    return "Generation limit reached for this account (402). Upgrade the Ridvay plan to continue generating.";
  }
  const snippet = body.length > 300 ? `${body.slice(0, 300)}…` : body;
  return `Ridvay API error ${status}: ${snippet}`;
}

/**
 * Counts image slots that were deferred (a generation prompt but no rendered
 * pixels yet) so callers know whether a background resolve pass is pending.
 */
export function countPendingImages(ir: DesignIr | undefined): number {
  if (!ir) return 0;
  let pending = 0;
  for (const page of ir.pages ?? []) {
    const bg = page.background;
    // A background resolves its rendered image into `url` (the API's DesignBackground field);
    // elements use `src`. Checking only `src` treated every resolved background as forever-pending,
    // so check_poster looped "1 image still rendering" indefinitely. Resolved if EITHER is set.
    if (bg && bg.type === "image" && bg.prompt && !bg.url && !bg.src) pending++;
    for (const el of page.elements ?? []) {
      if (el.type === "image" && el.prompt && !el.src && !el.canonicalKey && !el.vectorSvg) {
        pending++;
      }
    }
  }
  return pending;
}
