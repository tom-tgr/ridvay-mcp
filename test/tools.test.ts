import { describe, expect, it, vi } from "vitest";
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
} from "../src/tools.js";
import { DESIGN_GUIDE } from "../src/guide.js";
import { RidvayApiError } from "../src/ridvayClient.js";
import type { RidvayClient } from "../src/ridvayClient.js";

function makeCtx(overrides: Partial<Record<keyof RidvayClient, unknown>>): ToolContext {
  const client = {
    generateDesign: vi.fn(),
    resolveImages: vi.fn(async () => ({ status: "success" })),
    refineDesign: vi.fn(),
    getDesign: vi.fn(),
    shareDesign: vi.fn(async () => ({ status: "success", isPublic: true })),
    createDesign: vi.fn(async () => ({ status: "success", id: "made1" })),
    renderImage: vi.fn(async () => ({ imageUrl: "https://cdn/out.png" })),
    animateDesign: vi.fn(),
    renderVideo: vi.fn(async () => ({ videoUrl: "https://cdn/out.mp4" })),
    createExportJob: vi.fn(async () => ({ jobId: "job1", status: "queued" })),
    getExportJob: vi.fn(async () => ({ jobId: "job1", status: "done", url: "https://cdn/out.png" })),
    ...overrides,
  } as unknown as RidvayClient;
  // Instant sleep + tiny poll budget: async-export tests never wait on real timers.
  return { client, sleep: async () => {}, exportPollBudgetMs: 50 };
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
    // edit link is the public remix URL (works for any viewer), no ?open= anymore
    expect(text).toContain("https://ridvay.com/studio?remix=abc123");
    expect(text).not.toContain("?open=");
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
    expect(text).toContain("private");
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

  it("forwards agent_model to the client for attribution", async () => {
    const generateDesign = vi.fn(async () => ({
      status: "success",
      designId: "d",
      ir: IR_COMPLETE,
    }));
    const ctx = makeCtx({ generateDesign });

    await generatePoster(ctx, { prompt: "p", agent_model: "claude-fable-5" });

    expect(generateDesign).toHaveBeenCalledWith(
      expect.objectContaining({ agentModel: "claude-fable-5" }),
    );
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
      undefined,
      { agentModel: undefined },
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

  it("forwards agent_model to the client for attribution", async () => {
    const ctx = makeCtx({});

    await createPoster(ctx, { design: AUTHORED_DESIGN, agent_model: "claude-fable-5" });

    expect(ctx.client.createDesign).toHaveBeenCalledWith(expect.anything(), undefined, {
      agentModel: "claude-fable-5",
    });
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

  it("tells agents to pass their model id in agent_model", () => {
    expect(DESIGN_GUIDE).toContain("agent_model");
    expect(DESIGN_GUIDE).toContain("quality attribution");
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

  it("forwards agent_model to the client for attribution", async () => {
    const refineDesign = vi.fn(async () => ({
      status: "success",
      designId: "abc123",
      ir: IR_COMPLETE,
    }));
    const ctx = makeCtx({ refineDesign });

    await refinePoster(ctx, {
      design_id: "abc123",
      instruction: "make it red",
      agent_model: "claude-fable-5",
    });

    expect(refineDesign).toHaveBeenCalledWith(
      "abc123",
      expect.objectContaining({ agentModel: "claude-fable-5" }),
    );
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

  it("is honest about permanently-failed images (server loop-breaker) without re-triggering", async () => {
    // After repeated failures the server moves prompt → failedPrompt: not pending, but not perfect.
    const ctx = makeCtx({
      getDesign: vi.fn(async () => ({
        ir: {
          title: "Sale",
          pages: [{ background: { type: "image", failedPrompt: "a beach" }, elements: [] }],
        },
      })),
    });

    const text = await checkPoster(ctx, { design_id: "abc123" });

    expect(text).toContain("✅"); // nothing pending — no infinite "still rendering"
    expect(text).toContain("1 image(s) permanently failed");
    expect(text).toContain("refine_poster");
    expect(ctx.client.resolveImages).not.toHaveBeenCalled();
  });
});

describe("exportPoster", () => {
  it("enqueues an async image job and returns the URL once the poll sees it done", async () => {
    const createExportJob = vi.fn(async () => ({ jobId: "job1", status: "queued" }));
    const getExportJob = vi.fn(async () => ({ jobId: "job1", status: "done", url: "https://cdn/poster.png" }));
    const ctx = makeCtx({ createExportJob, getExportJob });

    const text = await exportPoster(ctx, { design_id: "d1", format: "png", scale: 2 });

    expect(createExportJob).toHaveBeenCalledWith("d1", {
      kind: "image",
      format: "png",
      scale: 2,
      quality: undefined,
      pageIndex: undefined,
    });
    expect(text).toContain("https://cdn/poster.png");
    expect(text).toContain("PNG");
  });

  it("surfaces a failed job's error", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "job1", status: "failed", error: "render failed after retries" })),
    });
    await expect(exportPoster(ctx, { design_id: "d1", page: 1 })).rejects.toThrow(/could not export/i);
  });

  it("hands back the job id + check_export when the poll budget expires", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "job1", status: "running" })),
    });
    const text = await exportPoster(ctx, { design_id: "d1" });
    expect(text).toContain("job ID: job1");
    expect(text).toContain("check_export");
  });

  it("falls back to the synchronous render when the API predates export jobs (404)", async () => {
    const renderImage = vi.fn(async () => ({ imageUrl: "https://cdn/poster.png" }));
    const ctx = makeCtx({
      createExportJob: vi.fn(async () => {
        throw new RidvayApiError("not found", 404);
      }),
      renderImage,
    });

    const text = await exportPoster(ctx, { design_id: "d1", format: "png", scale: 2, page: 1 });

    expect(renderImage).toHaveBeenCalledWith("d1", {
      format: "png",
      scale: 2,
      quality: undefined,
      pageIndex: 1,
    });
    expect(text).toContain("https://cdn/poster.png");
  });

  it("sync fallback still throws a helpful error on render failure", async () => {
    const ctx = makeCtx({
      createExportJob: vi.fn(async () => {
        throw new RidvayApiError("not found", 404);
      }),
      renderImage: vi.fn(async () => ({ error: "render_failed" })),
    });
    await expect(exportPoster(ctx, { design_id: "d1" })).rejects.toThrow(/could not export/i);
  });
});

describe("checkExport", () => {
  it("returns the download URL when the job is done", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "job1", kind: "image", status: "done", url: "https://cdn/x.png" })),
    });
    const text = await checkExport(ctx, { job_id: "job1" });
    expect(text).toContain("https://cdn/x.png");
    expect(text).toContain("✅");
  });

  it("reports a running job with a wait hint", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "job1", kind: "video", status: "running" })),
    });
    const text = await checkExport(ctx, { job_id: "job1" });
    expect(text).toContain("Still rendering");
    expect(text).toContain("60 seconds");
  });

  it("throws with the failure reason", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "job1", status: "failed", error: "worker interrupted" })),
    });
    await expect(checkExport(ctx, { job_id: "job1" })).rejects.toThrow(/worker interrupted/);
  });
});

describe("animatePoster", () => {
  it("animates and returns a preview link", async () => {
    const animateDesign = vi.fn(async () => ({ status: "success", designId: "d1", ir: { title: "Sale" } }));
    const ctx = makeCtx({ animateDesign });

    const text = await animatePoster(ctx, { design_id: "d1", description: "headline types on" });

    expect(animateDesign).toHaveBeenCalledWith("d1", { description: "headline types on" });
    expect(text).toContain("Motion added");
    expect(text).toContain("headline types on");
    expect(text).toContain("https://ridvay.com/studio?remix=d1");
  });

  it("notes the default animation when no description is given", async () => {
    const ctx = makeCtx({
      animateDesign: vi.fn(async () => ({ status: "success", designId: "d1", ir: {} })),
    });
    const text = await animatePoster(ctx, { design_id: "d1" });
    expect(text).toContain("default animation");
  });

  it("throws on animate failure", async () => {
    const ctx = makeCtx({ animateDesign: vi.fn(async () => ({ status: "error", error: "nope" })) });
    await expect(animatePoster(ctx, { design_id: "d1" })).rejects.toThrow(/nope/);
  });
});

describe("exportVideo", () => {
  it("enqueues an async video job and returns the MP4 URL when done in budget", async () => {
    const createExportJob = vi.fn(async () => ({ jobId: "vj1", status: "queued" }));
    const getExportJob = vi.fn(async () => ({ jobId: "vj1", status: "done", url: "https://cdn/clip.mp4" }));
    const ctx = makeCtx({ createExportJob, getExportJob });

    const text = await exportVideo(ctx, { design_id: "d1", fps: 30 });

    expect(createExportJob).toHaveBeenCalledWith("d1", { kind: "video", fps: 30, audioUrl: undefined });
    expect(text).toContain("https://cdn/clip.mp4");
  });

  it("hands back a job id for the typical minutes-long render", async () => {
    const ctx = makeCtx({
      createExportJob: vi.fn(async () => ({ jobId: "vj1", status: "queued" })),
      getExportJob: vi.fn(async () => ({ jobId: "vj1", status: "running" })),
    });
    const text = await exportVideo(ctx, { design_id: "d1" });
    expect(text).toContain("job ID: vj1");
    expect(text).toContain("check_export");
  });

  it("throws a motion hint when the job fails", async () => {
    const ctx = makeCtx({
      getExportJob: vi.fn(async () => ({ jobId: "vj1", status: "failed", error: "no motion" })),
    });
    await expect(exportVideo(ctx, { design_id: "d1" })).rejects.toThrow(/animate_poster/);
  });

  it("falls back to the synchronous render-video when the API predates export jobs (404)", async () => {
    const getDesign = vi.fn(async () => ({ ir: { title: "Sale", pages: [{ elements: [] }] } }));
    const renderVideo = vi.fn(async () => ({ videoUrl: "https://cdn/clip.mp4" }));
    const ctx = makeCtx({
      createExportJob: vi.fn(async () => {
        throw new RidvayApiError("not found", 404);
      }),
      getDesign,
      renderVideo,
    });

    const text = await exportVideo(ctx, { design_id: "d1", fps: 30 });

    expect(getDesign).toHaveBeenCalledWith("d1");
    expect(renderVideo).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sale" }),
      { fps: 30, audioUrl: undefined },
    );
    expect(text).toContain("https://cdn/clip.mp4");
  });
});
