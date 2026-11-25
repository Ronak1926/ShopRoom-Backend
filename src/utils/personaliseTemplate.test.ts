import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotificationDesignSchema, type CompositionNode, type NotificationDesign } from "../schemas/notification.schema.js";
import { compactShopName, personaliseTemplate, shopChipWidth } from "./personaliseTemplate.js";

function design(elements: unknown[]): NotificationDesign {
  const now = new Date().toISOString();
  return NotificationDesignSchema.parse({
    schemaVersion: 2, id: "t", name: "T", category: "OFFER", status: "DRAFT",
    canvas: { width: 400, height: 200, background: { type: "SOLID", color: "#000000" } },
    elements,
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  });
}

const chip = (name: string, x = 14) => ({
  id: "shop", type: "CONTAINER", frame: { x, y: 14, width: shopChipWidth(name), height: 22 },
  layout: { direction: "row" },
  children: [
    { id: "shop-initial", type: "LABEL", frame: { x: 0, y: 0, width: 16, height: 16 }, content: { text: name[0] } },
    { id: "shop-name", type: "TEXT", frame: { x: 0, y: 0, width: shopChipWidth(name) - 34, height: 14 }, content: { text: name } },
  ],
});

const node = (d: NotificationDesign, id: string): CompositionNode => {
  const stack = [...d.elements];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.id === id) return n;
    stack.push(...(n.children ?? []));
  }
  throw new Error(id);
};

describe("compactShopName", () => {
  it("keeps the first words that fit in 15 characters", () => {
    assert.equal(compactShopName("Fresh Fruits Corner"), "Fresh Fruits");
    assert.equal(compactShopName("Gold Leaf Jewellers"), "Gold Leaf");
    assert.equal(compactShopName("Bake Studio"), "Bake Studio");
    assert.equal(compactShopName("Supercalifragilistic Store"), "Supercalifragilistic");
  });
});

describe("personaliseTemplate", () => {
  it("puts the real shop name in the pill, its initial, and every line that mentions the sample", () => {
    const d = design([
      chip("Riya Boutique"),
      { id: "label", type: "TEXT", frame: { x: 0, y: 0, width: 200, height: 14 }, content: { text: "Riya Boutique · Combo" } },
      { id: "cta", type: "BUTTON", frame: { x: 0, y: 0, width: 100, height: 28 }, content: { label: "Visit Riya Boutique" } },
      { id: "name", type: "TEXT", frame: { x: 0, y: 0, width: 200, height: 50 }, content: { text: "Banarasi Silk Saree" } },
    ]);
    const out = personaliseTemplate(d, "Riya Boutique", "Sharma Fashion House");
    assert.equal(node(out, "shop-name").content?.text, "Sharma Fashion House");
    assert.equal(node(out, "shop-initial").content?.text, "S");
    assert.equal(node(out, "label").content?.text, "Sharma Fashion House · Combo");
    assert.equal(node(out, "cta").content?.label, "Visit Sharma Fashion House");
    assert.equal(node(out, "name").content?.text, "Banarasi Silk Saree", "product copy is untouched");
    assert.equal(node(out, "shop").frame.width, shopChipWidth("Sharma Fashion House"), "the pill fits the new name");
    assert.equal(node(out, "shop-name").frame.width, shopChipWidth("Sharma Fashion House") - 34);
  });

  it("replaces the shortened label form too, and keeps a right-aligned pill against the right edge", () => {
    const sample = "Fresh Fruits Corner";
    const right = 386 - shopChipWidth(sample);
    const d = design([
      chip(sample, right),
      { id: "label", type: "TEXT", frame: { x: 0, y: 0, width: 120, height: 14 }, content: { text: "Fresh Fruits" } },
    ]);
    const out = personaliseTemplate(d, sample, "Gupta Fruit Mart");
    assert.equal(node(out, "label").content?.text, "Gupta Fruit");
    const pill = node(out, "shop").frame;
    assert.equal(pill.x + pill.width, 386);
  });

  it("caps the pill for a very long name, and leaves a design alone without a sample or a real name", () => {
    const d = design([chip("Bake Studio")]);
    const long = "Shree Ganesh General Stores and Provisions";
    assert.equal(node(personaliseTemplate(d, "Bake Studio", long), "shop").frame.width, 180);
    assert.equal(personaliseTemplate(d, null, "X Shop"), d);
    assert.equal(personaliseTemplate(d, "Bake Studio", "  "), d);
  });
});
