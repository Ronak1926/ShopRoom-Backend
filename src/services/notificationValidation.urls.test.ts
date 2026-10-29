import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDesign } from "./notificationValidation.service.js";
import { sampleDesign } from "../test/integration.js";

type Design = ReturnType<typeof sampleDesign>;

/** A valid design with one extra element, so each test varies only the URL under test. */
function withElement(extra: Record<string, unknown>): Design {
  const design = sampleDesign();
  design.elements.push({
    id: "extra",
    type: "BUTTON",
    frame: { x: 0, y: 0, width: 100, height: 40 },
    content: { text: "Shop now" },
    visible: true,
    locked: false,
    ...extra,
  } as never);
  return design;
}

const click = (action: Record<string, unknown>) => ({ interaction: { onClick: action } });
const issuesOf = (design: unknown) => {
  const result = validateDesign(design);
  return result.valid ? [] : result.issues.map((i) => i.path);
};

describe("design URL validation", () => {
  it("accepts a normal design and a public OPEN_URL link", () => {
    assert.equal(validateDesign(sampleDesign()).valid, true);
    const design = withElement(click({ type: "OPEN_URL", url: "https://shop.example.com/offers" }));
    assert.equal(validateDesign(design).valid, true);
  });

  it("rejects OPEN_URL links that are not public http(s)", () => {
    for (const url of [
      "javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://accounts.google.com@evil.example/login",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:3001/api/shop/me",
    ]) {
      const design = withElement(click({ type: "OPEN_URL", url }));
      assert.ok(issuesOf(design).some((p) => p.endsWith("url")), url);
    }
  });

  it("requires a url on OPEN_URL and forbids smuggling one onto other actions", () => {
    assert.ok(issuesOf(withElement(click({ type: "OPEN_URL" }))).length > 0);
    const smuggled = withElement(click({ type: "OPEN_ROOM", url: "https://shop.example.com" }));
    assert.ok(issuesOf(smuggled).length > 0);
  });

  it("only accepts images from trusted hosts", () => {
    const trusted = withElement({
      asset: { type: "IMAGE", url: "https://res.cloudinary.com/demo/image/upload/a.jpg" },
    });
    assert.equal(validateDesign(trusted).valid, true);

    for (const url of [
      "https://tracker.example.com/pixel.gif?uid=1",
      "http://res.cloudinary.com/demo/a.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
    ]) {
      const design = withElement({ asset: { type: "IMAGE", url } });
      assert.ok(issuesOf(design).length > 0, url);
    }
  });

  it("applies the same rule to background images and attribution links", () => {
    const design = sampleDesign();
    design.canvas.background = { type: "IMAGE", imageUrl: "https://tracker.example.com/a.png" } as never;
    assert.ok(issuesOf(design).length > 0);

    const attribution = withElement({
      asset: {
        type: "IMAGE",
        url: "https://images.pexels.com/photos/1/a.jpeg",
        attribution: { photographer: "A", photographerUrl: "javascript:alert(1)" },
      },
    });
    assert.ok(issuesOf(attribution).length > 0);
  });
});
