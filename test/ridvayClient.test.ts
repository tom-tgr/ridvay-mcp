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

  it("POSTs share with the public flag", async () => {
    const fetchFn = mockFetch(200, { status: "success", isPublic: true });
    const client = new RidvayClient({ baseUrl: "https://a.com", apiKey: "k", fetchFn });

    await client.shareDesign("d1");

    const { url, init } = lastCall(fetchFn);
    expect(url).toBe("https://a.com/v1/Designs/d1/share");
    expect(JSON.parse(init.body as string)).toEqual({ public: true });
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

  it("returns 0 for missing or empty IR", () => {
    expect(countPendingImages(undefined)).toBe(0);
    expect(countPendingImages({})).toBe(0);
    expect(countPendingImages({ pages: [] })).toBe(0);
  });
});
