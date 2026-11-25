import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotificationDesignSchema, type NotificationDesign } from "../schemas/notification.schema.js";
import { animationEditViolation, quickEditViolation } from "./designEditRules.js";

const PHOTO = "https://images.unsplash.com/photo-1?w=900";
const OTHER_PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/shop/photo.jpg";

function design(): NotificationDesign {
  const now = new Date().toISOString();
  return NotificationDesignSchema.parse({
    schemaVersion: 2,
    id: "d1",
    name: "Sale",
    category: "SALE",
    status: "DRAFT",
    canvas: { width: 400, height: 200, background: { type: "SOLID", color: "#111111" } },
    elements: [
      {
        id: "product-photo", type: "IMAGE", frame: { x: 0, y: 0, width: 400, height: 200 },
        asset: { type: "IMAGE", url: PHOTO, attribution: { provider: "UNSPLASH" } }, image: { fit: "cover", position: "center" },
      },
      {
        id: "shop", type: "CONTAINER", frame: { x: 14, y: 14, width: 120, height: 22 },
        children: [{ id: "shop-name", type: "TEXT", frame: { x: 0, y: 0, width: 90, height: 14 }, content: { text: "Riya Boutique" } }],
      },
      {
        id: "name", type: "TEXT", frame: { x: 20, y: 70, width: 200, height: 50 },
        style: { color: "#FFFFFF", fontSize: 24 }, content: { text: "Silk Saree" },
        animation: { entry: { type: "SLIDE_UP", delayMs: 200 } },
      },
      { id: "cta", type: "BUTTON", frame: { x: 20, y: 160, width: 100, height: 28 }, content: { label: "Shop now" } },
    ],
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  });
}

/** A deep copy changed by `edit`, re-parsed the way the API parses a save. */
function edited(edit: (d: NotificationDesign) => void): NotificationDesign {
  const copy = structuredClone(design());
  edit(copy);
  return NotificationDesignSchema.parse(copy);
}

const find = (d: NotificationDesign, id: string) => {
  const stack = [...d.elements];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.id === id) return n;
    stack.push(...(n.children ?? []));
  }
  throw new Error(`no node ${id}`);
};

describe("quick edit (1 Month plan)", () => {
  it("allows changing words, nested words, button labels, photos and the design name", () => {
    const next = edited((d) => {
      d.name = "Diwali offer";
      find(d, "name").content!.text = "Banarasi Saree";
      find(d, "shop-name").content!.text = "Sharma Fashion";
      find(d, "cta").content!.label = "Visit us";
      const photo = find(d, "product-photo");
      photo.asset = { type: "IMAGE", url: OTHER_PHOTO, naturalWidth: 1200, naturalHeight: 800 };
      photo.image = { ...photo.image!, crop: { x: 0.1, y: 0, width: 0.8, height: 1 }, position: "top" };
    });
    assert.equal(quickEditViolation(design(), next), null);
  });

  it("refuses moving, resizing, restyling, adding or removing elements", () => {
    const cases: [string, (d: NotificationDesign) => void][] = [
      ["move", (d) => { find(d, "name").frame.x = 40; }],
      ["resize", (d) => { find(d, "name").frame.width = 300; }],
      ["restyle", (d) => { find(d, "name").style!.color = "#FF0000"; }],
      ["background", (d) => { d.canvas.background = { type: "SOLID", color: "#FFFFFF" }; }],
      ["add", (d) => { d.elements.push({ id: "extra", type: "TEXT", frame: { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 }, content: { text: "hi" }, visible: true, locked: false }); }],
      ["remove", (d) => { d.elements.pop(); }],
      ["hide", (d) => { find(d, "cta").visible = false; }],
      ["animate", (d) => { find(d, "name").animation = { entry: { type: "POP", durationMs: 500, delayMs: 0, easing: "easeOut" } }; }],
      ["swap a text box for a picture", (d) => { find(d, "name").type = "IMAGE"; }],
    ];
    for (const [what, edit] of cases) {
      assert.ok(quickEditViolation(design(), edited(edit)), `${what} should be refused`);
    }
  });
});

describe("custom animation (3 Months only)", () => {
  it("allows any non-animation edit, including new elements without an animation", () => {
    const next = edited((d) => {
      find(d, "name").frame.x = 60;
      find(d, "name").style!.color = "#FF0000";
      d.elements.push({ id: "extra", type: "TEXT", frame: { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 }, content: { text: "hi" }, visible: true, locked: false });
    });
    assert.equal(animationEditViolation(design(), next), null);
  });

  it("refuses changing, removing or adding an animation", () => {
    const step = { type: "POP" as const, durationMs: 500, delayMs: 0, easing: "easeOut" as const };
    const cases: [string, (d: NotificationDesign) => void][] = [
      ["change", (d) => { find(d, "name").animation = { entry: step }; }],
      ["remove", (d) => { delete find(d, "name").animation; }],
      ["add to an existing element", (d) => { find(d, "cta").animation = { entry: step }; }],
      ["add with a new element", (d) => { d.elements.push({ id: "extra", type: "TEXT", frame: { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 }, animation: { entry: step }, visible: true, locked: false }); }],
      ["whole-design animation", (d) => { d.globalAnimation = { entry: step }; }],
    ];
    for (const [what, edit] of cases) {
      assert.ok(animationEditViolation(design(), edited(edit)), `${what} should be refused`);
    }
  });
});
