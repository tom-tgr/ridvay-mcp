import { describe, expect, it, vi } from "vitest";
import { checkPoster, createPoster, generatePoster, refinePoster, ToolContext } from "../src/tools.js";
import { DESIGN_GUIDE } from "../src/guide.js";
import type { RidvayClient } from "../src/ridvayClient.js";

function makeCtx(overrides: Partial<Record<keyof RidvayClient, unknown>>): ToolContext {
  const client = {
    generateDesign: vi.fn(),
    resolveImages: vi.fn(async () => ({ status: "success" })),
    refineDesign: vi.fn(),
    getDesign: vi.fn(),
    shareDesign: vi.fn(async () => ({ status: "success", isPublic: true })),
    createDesign: vi.fn(async () => ({ status: "success", id: "made1" })),
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

describe("createPoster", () => {
  const AUTHORED_DESIGN = {
    title: "Hand Made",
    pages: [
      {
        width: 1080,
        height: 1350,
        background: { type: "solid", color: "#111111" },
        elements: [{ id: "h", type: "text", x: 0, y: 0, width: 100, height: 50, lines: [] }],
      },
    ],
  };

  it("saves the authored IR, shares it, and returns links", async () => {
    const createDesign = vi.fn(async () => ({
      status: "success",
      id: "made1",
      ir: { ...AUTHORED_DESIGN, version: "1.0", type: "design" },
    }));
    const ctx = makeCtx({ createDesign });

    const text = await createPoster(ctx, { design: AUTHORED_DESIGN });

    expect(createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1.0", type: "design", title: "Hand Made" }),
    );
    expect(text).toContain('"Hand Made"');
    expect(text).toContain("https://ridvay.com/d/made1");
    expect(ctx.client.shareDesign).toHaveBeenCalledWith("made1", true);
    expect(ctx.client.resolveImages).not.toHaveBeenCalled();
  });

  it("fires the image-resolve pass when the authored IR contains image prompts", async () => {
    const withPrompt = {
      ...AUTHORED_DESIGN,
      pages: [
        {
          ...AUTHORED_DESIGN.pages[0],
          background: { type: "image", prompt: "moody espresso bar" },
        },
      ],
    };
    const ctx = makeCtx({
      createDesign: vi.fn(async () => ({ status: "success", id: "made1", ir: withPrompt })),
    });

    const text = await createPoster(ctx, { design: withPrompt });

    expect(ctx.client.resolveImages).toHaveBeenCalledWith("made1");
    expect(text).toContain("rendering server-side");
  });

  it("rejects structurally invalid designs with a pointer to the guide", async () => {
    const ctx = makeCtx({});

    await expect(createPoster(ctx, { design: { title: "no pages" } })).rejects.toThrow(
      /get_design_guide/,
    );
    expect(ctx.client.createDesign).not.toHaveBeenCalled();
  });

  it("keeps the design private when share is false", async () => {
    const ctx = makeCtx({});

    const text = await createPoster(ctx, { design: AUTHORED_DESIGN, share: false });

    expect(ctx.client.shareDesign).not.toHaveBeenCalled();
    expect(text).not.toContain("/d/made1");
    expect(text).toContain("private");
  });
});

describe("DESIGN_GUIDE", () => {
  it("documents the core IR contract", () => {
    for (const landmark of [
      '"pages"',
      '"type": "gradient"',
      '"stops"',
      "fontFamily",
      "canonicalKey",
      "create_poster",
    ]) {
      expect(DESIGN_GUIDE).toContain(landmark);
    }
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
