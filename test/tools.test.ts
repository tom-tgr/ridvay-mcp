import { describe, expect, it, vi } from "vitest";
import { checkPoster, generatePoster, refinePoster, ToolContext } from "../src/tools.js";
import type { RidvayClient } from "../src/ridvayClient.js";

function makeCtx(overrides: Partial<Record<keyof RidvayClient, unknown>>): ToolContext {
  const client = {
    generateDesign: vi.fn(),
    resolveImages: vi.fn(async () => ({ status: "success" })),
    refineDesign: vi.fn(),
    getDesign: vi.fn(),
    shareDesign: vi.fn(async () => ({ status: "success", isPublic: true })),
    ...overrides,
  } as unknown as RidvayClient;
  return { client };
}

const IR_WITH_PENDING = {
  title: "Summer Sale",
  pages: [{ background: { type: "image", prompt: "beach" }, elements: [] }],
};

const IR_COMPLETE = {
  title: "Summer Sale",
  pages: [{ background: { type: "solid" }, elements: [{ type: "image", src: "https://x/y.png" }] }],
};

describe("generatePoster", () => {
  it("returns links and fires background image resolution when images are pending", async () => {
    const ctx = makeCtx({
      generateDesign: vi.fn(async () => ({
        status: "success",
        designId: "abc123",
        ir: IR_WITH_PENDING,
        usage: { model: "gemini", latencyMs: 21000 },
      })),
    });

    const text = await generatePoster(ctx, { prompt: "summer sale poster" });

    expect(text).toContain('"Summer Sale"');
    expect(text).toContain("abc123");
    expect(text).toContain("https://ridvay.com/d/abc123");
    expect(text).toContain("https://ridvay.com/studio?open=abc123");
    expect(text).toContain("https://ridvay.com/studio?remix=abc123");
    expect(text).toContain("rendering in the background");
    expect(ctx.client.resolveImages).toHaveBeenCalledWith("abc123");
    expect(ctx.client.shareDesign).toHaveBeenCalledWith("abc123", true);
  });

  it("skips sharing and omits public links when share is false", async () => {
    const ctx = makeCtx({
      generateDesign: vi.fn(async () => ({
        status: "success",
        designId: "abc123",
        ir: IR_COMPLETE,
      })),
    });

    const text = await generatePoster(ctx, { prompt: "p", share: false });

    expect(ctx.client.shareDesign).not.toHaveBeenCalled();
    expect(text).not.toContain("/d/abc123");
    expect(text).not.toContain("remix=abc123");
    expect(text).toContain("https://ridvay.com/studio?open=abc123");
    expect(text).toContain("private");
  });

  it("still returns the design when the share call fails", async () => {
    const ctx = makeCtx({
      generateDesign: vi.fn(async () => ({
        status: "success",
        designId: "abc123",
        ir: IR_COMPLETE,
      })),
      shareDesign: vi.fn(async () => {
        throw new Error("share broke");
      }),
    });

    const text = await generatePoster(ctx, { prompt: "p" });

    expect(text).toContain("abc123");
    expect(text).toContain("https://ridvay.com/studio?open=abc123");
    expect(text).not.toContain("/d/abc123");
  });

  it("does not fire image resolution when nothing is pending", async () => {
    const ctx = makeCtx({
      generateDesign: vi.fn(async () => ({
        status: "success",
        designId: "abc123",
        ir: IR_COMPLETE,
      })),
    });

    const text = await generatePoster(ctx, { prompt: "p" });

    expect(text).not.toContain("rendering in the background");
    expect(ctx.client.resolveImages).not.toHaveBeenCalled();
  });

  it("throws with the API's error message on failed generations", async () => {
    const ctx = makeCtx({
      generateDesign: vi.fn(async () => ({ status: "error", error: "model overloaded" })),
    });

    await expect(generatePoster(ctx, { prompt: "p" })).rejects.toThrow(/model overloaded/);
  });

  it("passes size and brand flags through to the client", async () => {
    const generateDesign = vi.fn(async () => ({
      status: "success",
      designId: "d",
      ir: IR_COMPLETE,
    }));
    const ctx = makeCtx({ generateDesign });

    await generatePoster(ctx, { prompt: "p", size: "story", use_brand: true });

    expect(generateDesign).toHaveBeenCalledWith({
      prompt: "p",
      size: "story",
      useBrand: true,
      deferImages: true,
    });
  });

  it("honors a custom web URL for links", async () => {
    const ctx = {
      ...makeCtx({
        generateDesign: vi.fn(async () => ({ status: "success", designId: "d", ir: IR_COMPLETE })),
      }),
      webUrl: "https://staging.ridvay.com/",
    };

    const text = await generatePoster(ctx, { prompt: "p" });

    expect(text).toContain("https://staging.ridvay.com/d/d");
  });
});

describe("refinePoster", () => {
  it("sends the instruction to the refine endpoint and reports the update", async () => {
    const refineDesign = vi.fn(async () => ({
      status: "success",
      designId: "abc123",
      ir: IR_COMPLETE,
    }));
    const ctx = makeCtx({ refineDesign });

    const text = await refinePoster(ctx, { design_id: "abc123", instruction: "make it red" });

    expect(refineDesign).toHaveBeenCalledWith(
      "abc123",
      expect.objectContaining({ prompt: "make it red" }),
    );
    expect(text).toContain("Poster updated");
    expect(text).toContain("https://ridvay.com/d/abc123");
  });
});

describe("checkPoster", () => {
  it("reports pending images and re-triggers the resolve pass", async () => {
    const ctx = makeCtx({ getDesign: vi.fn(async () => ({ ir: IR_WITH_PENDING })) });

    const text = await checkPoster(ctx, { design_id: "abc123" });

    expect(text).toContain("still rendering");
    expect(text).toContain("https://ridvay.com/d/abc123");
    expect(ctx.client.resolveImages).toHaveBeenCalledWith("abc123");
  });

  it("does not re-trigger resolve when the design is complete", async () => {
    const ctx = makeCtx({ getDesign: vi.fn(async () => ({ ir: IR_COMPLETE })) });

    await checkPoster(ctx, { design_id: "abc123" });

    expect(ctx.client.resolveImages).not.toHaveBeenCalled();
  });

  it("reports completion and a preview image when available", async () => {
    const ctx = makeCtx({
      getDesign: vi.fn(async () => ({
        data: { ir: IR_COMPLETE, ogImage: "https://cdn.ridvay.com/og/abc.jpg" },
      })),
    });

    const text = await checkPoster(ctx, { design_id: "abc123" });

    expect(text).toContain("complete");
    expect(text).toContain("https://cdn.ridvay.com/og/abc.jpg");
  });
});
