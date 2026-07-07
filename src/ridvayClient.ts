/**
 * Thin HTTP client for the Ridvay API (api.ridvay.com).
 * Auth: opaque API key sent as `Authorization: Bearer <key>`.
 * Optional delegation: `X-Sub-User-Id` (honored only for admin/platform keys).
 */

export interface RidvayClientOptions {
  baseUrl: string;
  apiKey: string;
  subUserId?: string;
  /** Per-request timeout in ms. Deferred generates typically return in ~25s. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface GenerateDesignParams {
  prompt: string;
  size?: string;
  useBrand?: boolean;
  deferImages?: boolean;
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

  constructor(options: RidvayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.subUserId = options.subUserId;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generateDesign(params: GenerateDesignParams): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>("POST", "/v1/Designs/generate", {
      prompt: params.prompt,
      size: params.size,
      useBrand: params.useBrand ?? false,
      deferImages: params.deferImages ?? true,
    });
  }

  async resolveImages(designId: string): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/resolve-images`,
    );
  }

  async refineDesign(
    designId: string,
    params: { prompt: string; useBrand?: boolean },
  ): Promise<GenerateDesignResponse> {
    return this.request<GenerateDesignResponse>(
      "POST",
      `/v1/Designs/${encodeURIComponent(designId)}/refine`,
      { prompt: params.prompt, useBrand: params.useBrand ?? false },
    );
  }

  async getDesign(designId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/v1/Designs/${encodeURIComponent(designId)}`,
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.subUserId) headers["X-Sub-User-Id"] = this.subUserId;
    if (body !== undefined) headers["Content-Type"] = "application/json";

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
    if (bg && bg.type === "image" && bg.prompt && !bg.src) pending++;
    for (const el of page.elements ?? []) {
      if (el.type === "image" && el.prompt && !el.src && !el.canonicalKey && !el.vectorSvg) {
        pending++;
      }
    }
  }
  return pending;
}
