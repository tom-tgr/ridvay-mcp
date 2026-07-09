import { describe, expect, it, vi } from "vitest";
import { countPendingImages, RidvayApiError, RidvayClient } from "../src/ridvayClient.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

function lastCall(fetchFn: unknown): { url: string; init: RequestInit } {
  const mock = fetchFn as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

describe("RidvayClient", () => {
  it("POSTs generate with bearer auth and deferred images by default", async () => {
    const fetchFn = mockFetch(200, { status: "success", designId: "d1" });
    const client = new RidvayClient({
      baseUrl: "https://api.example.com/",
      apiKey: "sk-test",
      fetchFn,
    });

    const res = await client.generateDesign({ prompt: "summer sale poster", size: "1080x1080" });

    expect(res.designId).toBe("d1");
    const { url, init } = lastCall(fetchFn);
    expect(url).toBe("https://api.example.com/v1/Designs/generate");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["X-Sub-User-Id"]).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "summer sale poster",
      size: "1080x1080",
      useBrand: false,
      deferImages: true,
    });
  });

  it("sends X-Sub-User-Id when a sub-user is configured", async () => {
    const fetchFn = mockFetch(200, { status: "success", designId: "d1" });
    const client = new RidvayClient({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
      subUserId: "user-42",
      fetchFn,
    });

    await client.generateDesign({ prompt: "p" });

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Sub-User-Id"]).toBe("user-42");
  });

  it("URL-encodes design ids in paths", async () => {
    const fetchFn = mockFetch(200, { status: "success" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.resolveImages("id/with?chars");

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://a.com/v1/Designs/id%2Fwith%3Fchars/resolve-images");
  });

  it("maps 402 to a friendly generation-limit error", async () => {
    const fetchFn = mockFetch(402, { error: "generation_limit", limit: 20 });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await expect(client.generateDesign({ prompt: "p" })).rejects.toThrow(/Generation limit/);
  });

  it("maps 401 to an API-key hint", async () => {
    const fetchFn = mockFetch(401, "Authorization header is missing.");
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await expect(client.getDesign("d1")).rejects.toThrow(/RIDVAY_API_KEY/);
  });

  it("throws RidvayApiError on non-JSON success bodies", async () => {
    const fetchFn = mockFetch(200, "<html>oops</html>");
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await expect(client.getDesign("d1")).rejects.toBeInstanceOf(RidvayApiError);
  });

  it("POSTs client-authored IR to the create endpoint", async () => {
    const fetchFn = mockFetch(200, { status: "success", id: "d9" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    const ir = { version: "1.0", type: "design", title: "T", pages: [] };
    const res = await client.createDesign(ir);

    expect(res.id).toBe("d9");
    const { url, init } = lastCall(fetchFn);
    expect(url).toBe("https://a.com/v1/Designs/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).ir).toEqual(ir);
  });

  it("POSTs share with the public flag", async () => {
    const fetchFn = mockFetch(200, { status: "success", isPublic: true });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.shareDesign("d1");

    const { url, init } = lastCall(fetchFn);
    expect(url).toBe("https://a.com/v1/Designs/d1/share");
    expect(JSON.parse(init.body as string)).toEqual({ public: true });
  });

  it("sends X-Ridvay-Agent-Model on generate when an agent model is given", async () => {
    const fetchFn = mockFetch(200, { status: "success", designId: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.generateDesign({ prompt: "p", agentModel: "claude-fable-5" });

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Ridvay-Agent-Model"]).toBe("claude-fable-5");
  });

  it("sends X-Ridvay-Agent-Model on refine and create", async () => {
    const fetchFn = mockFetch(200, { status: "success", id: "d1", designId: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.refineDesign("d1", { prompt: "p", agentModel: "gpt-6" });
    await client.createDesign({ pages: [] }, undefined, { agentModel: "gemini-3-pro" });

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const refineHeaders = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const createHeaders = (mock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(refineHeaders["X-Ridvay-Agent-Model"]).toBe("gpt-6");
    expect(createHeaders["X-Ridvay-Agent-Model"]).toBe("gemini-3-pro");
  });

  it("omits X-Ridvay-Agent-Model when no agent model is given", async () => {
    const fetchFn = mockFetch(200, { status: "success", designId: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.generateDesign({ prompt: "p" });

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Ridvay-Agent-Model"]).toBeUndefined();
  });

  it("sanitizes header-hostile agent model values instead of crashing fetch", async () => {
    const fetchFn = mockFetch(200, { status: "success", designId: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.generateDesign({ prompt: "p", agentModel: "evil\r\nX-Other: 1" });

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Ridvay-Agent-Model"]).toBe("evil X-Other: 1");
  });

  it("sends X-Ridvay-Client on every request when the provider knows the client", async () => {
    const fetchFn = mockFetch(200, { id: "d1" });
    const client = new RidvayClient({
      baseUrl: "https://a.com",
      apiKey: "k",
      fetchFn,
      clientInfoProvider: () => "claude-code/2.1.0",
    });

    await client.getDesign("d1");

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Ridvay-Client"]).toBe("claude-code/2.1.0");
  });

  it("omits X-Ridvay-Client when the provider is missing or returns nothing", async () => {
    const bare = mockFetch(200, { id: "d1" });
    await new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn: bare }).getDesign("d1");
    expect((lastCall(bare).init.headers as Record<string, string>)["X-Ridvay-Client"]).toBeUndefined();

    const empty = mockFetch(200, { id: "d1" });
    await new RidvayClient({
      baseUrl: "https://a.com",
      apiKey: "k",
      fetchFn: empty,
      clientInfoProvider: () => undefined,
    }).getDesign("d1");
    expect((lastCall(empty).init.headers as Record<string, string>)["X-Ridvay-Client"]).toBeUndefined();
  });

  it("honors a provider set after construction (setClientInfoProvider)", async () => {
    const fetchFn = mockFetch(200, { id: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    client.setClientInfoProvider(() => "cursor/1.3.0");
    await client.getDesign("d1");

    const { init } = lastCall(fetchFn);
    expect((init.headers as Record<string, string>)["X-Ridvay-Client"]).toBe("cursor/1.3.0");
  });

  it("GETs designs without a request body", async () => {
    const fetchFn = mockFetch(200, { id: "d1" });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.getDesign("d1");

    const { url, init } = lastCall(fetchFn);
    expect(url).toBe("https://a.com/v1/Designs/d1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});

describe("countPendingImages", () => {
  it("counts unrendered image prompts in backgrounds and elements", () => {
    const ir = {
      pages: [
        {
          background: { type: "image", prompt: "a beach", src: undefined },
          elements: [
            { type: "image", prompt: "a palm tree" },
            { type: "image", prompt: "rendered", src: "https://cdn/x.png" },
            { type: "image", prompt: "vector", canonicalKey: "icon:star" },
            { type: "text" },
          ],
        },
        { background: { type: "solid" }, elements: [{ type: "image", prompt: "sunset" }] },
      ],
    };
    expect(countPendingImages(ir)).toBe(3);
  });

  it("treats a background resolved via `url` (not `src`) as done — the re-trigger-loop regression", () => {
    // The API stores a resolved background image in `url` (elements use `src`). Counting only `src`
    // made every resolved background read as forever-pending → check_poster looped indefinitely.
    const ir = {
      pages: [
        { background: { type: "image", prompt: "a beach", url: "https://cdn/bg.jpg" }, elements: [] },
      ],
    };
    expect(countPendingImages(ir)).toBe(0);
  });

  it("still counts a background with neither url nor src as pending", () => {
    const ir = { pages: [{ background: { type: "image", prompt: "a beach" }, elements: [] }] };
    expect(countPendingImages(ir)).toBe(1);
  });

  it("returns 0 for missing or empty IR", () => {
    expect(countPendingImages(undefined)).toBe(0);
    expect(countPendingImages({})).toBe(0);
    expect(countPendingImages({ pages: [] })).toBe(0);
  });
});
