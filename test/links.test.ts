import { describe, expect, it } from "vitest";
import { editUrl, remixUrl, viewUrl } from "../src/links.js";

describe("link builders", () => {
  it("builds the public share URL", () => {
    expect(viewUrl("abc123")).toBe("https://ridvay.com/d/abc123");
  });

  it("builds owner-edit and remix URLs", () => {
    expect(editUrl("abc123")).toBe("https://ridvay.com/studio?open=abc123");
    expect(remixUrl("abc123")).toBe("https://ridvay.com/studio?remix=abc123");
  });

  it("strips trailing slashes from custom web URLs and encodes ids", () => {
    expect(viewUrl("a b", { webUrl: "https://x.dev///" })).toBe("https://x.dev/d/a%20b");
  });
});
