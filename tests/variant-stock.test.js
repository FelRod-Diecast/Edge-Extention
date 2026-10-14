const test = require("node:test");
const assert = require("node:assert/strict");
const { findNewlyAvailableVariants } = require("../variant-stock.js");

test("detects a variant restock while the product remains available", () => {
  const previous = [
    { id: "48840538489037", available: false },
    { id: "other-variant", available: true }
  ];
  const current = [
    { id: "48840538489037", available: true },
    { id: "other-variant", available: true }
  ];

  assert.deepEqual(
    findNewlyAvailableVariants(previous, current).map(variant => variant.id),
    ["48840538489037"]
  );
});

test("does not alert for unchanged, sold-out, or first-seen variants", () => {
  const previous = [
    { id: "same", available: true },
    { id: "still-out", available: false }
  ];
  const current = [
    { id: "same", available: true },
    { id: "still-out", available: false },
    { id: "new", available: true }
  ];

  assert.deepEqual(findNewlyAvailableVariants(previous, current), []);
});

test("matches variant IDs consistently when one payload uses numbers", () => {
  const previous = [{ id: 48840538489037, available: false }];
  const current = [{ id: "48840538489037", available: true }];

  assert.equal(findNewlyAvailableVariants(previous, current).length, 1);
});
