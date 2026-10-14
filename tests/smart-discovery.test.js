const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "smart-discovery.js"), "utf8");

function makeHarness({ storedUpcoming = [], sourceHtml = "", productResponse } = {}) {
  const saved = { upcoming: null, hidden: null };
  const requestedProducts = [];
  const context = {
    console,
    Date,
    Intl,
    URL,
    Promise,
    Set,
    Map,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    JSON,
    queueMicrotask: callback => Promise.resolve().then(callback),
    fetch: async url => {
      if (url.includes("/products.json?")) {
        return { ok: true, json: async () => ({ products: [] }), text: async () => "" };
      }
      if (url.includes("/pages/") || url.includes("/collections/")) {
        return { ok: true, text: async () => sourceHtml };
      }
      if (url.includes("/products/")) {
        requestedProducts.push(url);
        return productResponse
          ? productResponse(url)
          : { ok: true, text: async () => '<meta property="og:title" content="Hot Wheels model"><div>Launches October 20, 2026 9:00 AM PT</div><button>Add to cart</button>' };
      }
      return { ok: false, text: async () => "", json: async () => null };
    },
    chrome: {
      storage: {
        local: {
          get: async () => ({ upcomingProducts: storedUpcoming }),
          set: async () => {}
        }
      }
    },
    itemsState: {},
    hiddenSeen: {},
    checkLiveInventory: async () => ({ ok: true, available: false }),
    canAlertItem: () => false,
    notifyBrowser: async () => false,
    sendWebhookEmbed: async () => {},
    scanUpcomingProducts: async () => {},
    scanHiddenProducts: async () => {},
    saveUpcoming: products => { saved.upcoming = products; },
    saveHidden: products => { saved.hidden = products; }
  };
  context.self = context;
  vm.runInNewContext(source, context, { filename: "smart-discovery.js" });
  return { context, saved, requestedProducts };
}

async function installed(harness) {
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof harness.context.scanUpcomingProducts, "function");
  assert.equal(typeof harness.context.scanHiddenProducts, "function");
}

test("keeps known upcoming products when a product-page request temporarily fails", async () => {
  const known = {
    handle: "rlc-exclusive-hot-wheels-test-car",
    title: "RLC Exclusive Hot Wheels Test Car",
    url: "https://creations.mattel.com/products/rlc-exclusive-hot-wheels-test-car",
    launchDate: "October 20, 2026 9:00 AM PT",
    launchTimestamp: Date.parse("2026-10-20T16:00:00Z"),
    upcoming: true
  };
  const harness = makeHarness({
    storedUpcoming: [known],
    productResponse: async () => ({ ok: false, status: 503, text: async () => "" })
  });
  await installed(harness);
  await harness.context.scanUpcomingProducts();
  assert.deepEqual(JSON.parse(JSON.stringify(harness.saved.upcoming)), [known]);
});

test("prioritizes an RLC candidate when more than 80 hidden candidates are found", async () => {
  const handles = Array.from({ length: 80 }, (_, index) => `hot-wheels-model-${String(index + 1).padStart(3, "0")}`);
  handles.push("rlc-exclusive-hot-wheels-model-081");
  const sourceHtml = handles.map(handle => `<a href="/products/${handle}">${handle}</a>`).join("\n");
  const harness = makeHarness({ sourceHtml });
  await installed(harness);
  await harness.context.scanHiddenProducts();
  assert.equal(harness.requestedProducts.length, 80);
  assert.ok(
    harness.requestedProducts.includes("https://creations.mattel.com/products/rlc-exclusive-hot-wheels-model-081"),
    "the RLC candidate should be scanned ahead of lower-priority candidates"
  );
  assert.ok(harness.saved.hidden.some(product => product.handle === "rlc-exclusive-hot-wheels-model-081"));
});
