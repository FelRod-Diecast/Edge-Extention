const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function makeHarness(candidateHtml = "") {
  const storage = {};
  const availability = new Map();
  const windows = [];
  let onMessage;
  let onAlarm;
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of keys) if (key in storage) out[key] = storage[key];
          return out;
        },
        async set(values) { Object.assign(storage, values); }
      }
    },
    runtime: {
      onMessage: { addListener(fn) { onMessage = fn; } },
      getURL(path) { return "chrome-extension://test/" + path; }
    },
    alarms: {
      onAlarm: { addListener(fn) { onAlarm = fn; } },
      create() {}
    },
    windows: {
      async create(options) { windows.push(options); return { id: windows.length }; },
      async update() {}
    },
    tabs: { async query() { return []; }, async update() {} }
  };

  async function fetchMock(url) {
    if (url.includes("/products/") && url.endsWith(".js")) {
      const handle = url.split("/products/")[1].replace(/\.js(?:\?.*)?$/, "");
      const available = Boolean(availability.get(handle));
      const isRlc = /rlc|red-line-club|elite-64/i.test(handle);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            title: isRlc ? "Hot Wheels RLC Test Product" : "Hot Wheels Test Product",
            variants: [{ id: isRlc ? 222 : 111, available }]
          };
        }
      };
    }
    return { ok: true, status: 200, async text() { return candidateHtml; } };
  }

  const source = fs.readFileSync("race-assist/background.js", "utf8");
  vm.runInNewContext(source, { chrome, fetch: fetchMock, URL, Date, console }, { filename: "background.js" });

  async function send(message) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) reject(new Error("Message timed out: " + message.action));
      }, 1000);
      onMessage(message, {}, result => {
        done = true;
        clearTimeout(timeout);
        resolve(result);
      });
    });
  }

  return { storage, availability, windows, send };
}

test("manual non-RLC quantity 20 is preserved and cart trigger is deduplicated", async () => {
  const h = makeHarness();
  h.availability.set("hot-wheels-premium-enzo-ferrari-jhw22", false);
  const added = await h.send({
    action: "addManualProduct",
    url: "https://creations.mattel.com/products/hot-wheels-premium-enzo-ferrari-jhw22?variant=111",
    quantity: 20
  });
  assert.equal(added.ok, true);
  assert.equal(added.product.quantity, 20);

  h.availability.set("hot-wheels-premium-enzo-ferrari-jhw22", true);
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 2);
  assert.ok(h.windows.some(w => /\/cart\/111:20$/.test(w.url)));

  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 2, "a continuously available product must not repeatedly open windows");
});

test("RLC quantity is clamped to two", async () => {
  const h = makeHarness();
  h.availability.set("hot-wheels-rlc-exclusive-test", false);
  const added = await h.send({
    action: "addManualProduct",
    url: "https://creations.mattel.com/products/hot-wheels-rlc-exclusive-test",
    quantity: 20
  });
  assert.equal(added.ok, true);
  assert.equal(added.product.quantity, 2);

  h.availability.set("hot-wheels-rlc-exclusive-test", true);
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 2);
  assert.ok(h.windows.some(w => /\/cart\/222:2$/.test(w.url)), "RLC cart must stay at quantity two");
});

test("manual URL rejects non-Mattel origins", async () => {
  const h = makeHarness();
  const result = await h.send({
    action: "addManualProduct",
    url: "https://example.com/products/not-mattel",
    quantity: 20
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Mattel Creations product URL/);
});

test("product already available when added does not trigger a false restock", async () => {
  const h = makeHarness();
  h.availability.set("hot-wheels-premium-enzo-ferrari-jhw22", true);
  const added = await h.send({
    action: "addManualProduct",
    url: "https://creations.mattel.com/products/hot-wheels-premium-enzo-ferrari-jhw22",
    quantity: 20
  });
  assert.equal(added.ok, true);
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 0);
});

test("availability re-arms after a product sells out and returns", async () => {
  const h = makeHarness();
  const handle = "hot-wheels-rlc-exclusive-rearm-test";
  h.availability.set(handle, true);

  const added = await h.send({
    action: "addManualProduct",
    url: "https://creations.mattel.com/products/" + handle,
    quantity: 2
  });
  assert.equal(added.ok, true);
  assert.equal(added.product.wasAvailable, true);

  // A sellout must reset the transition latch without opening windows.
  h.availability.set(handle, false);
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 0);

  // A later restock must trigger the handoff again.
  h.availability.set(handle, true);
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 2);
  assert.ok(h.windows.some(w => /\/cart\/222:2$/.test(w.url)));

  // Staying available must not trigger another duplicate handoff.
  await h.send({ action: "checkNow" });
  assert.equal(h.windows.length, 2);
});


test("discovery validates live product data, uses real titles, and filters non-RLC links", async () => {
  const html = [
    "/products/hot-wheels-rlc-exclusive-live-test",
    "/products/hot-wheels-premium-enzo-ferrari-jhw22",
    "/products/hot-wheels-elite-64-live-test"
  ].join(" ");
  const h = makeHarness(html);
  const result = await h.send({ action: "discover" });
  assert.equal(result.ok, true);

  const candidates = h.storage.raceAssistCandidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map(p => p.handle).sort(),
    ["hot-wheels-elite-64-live-test", "hot-wheels-rlc-exclusive-live-test"]
  );
  assert.ok(candidates.every(p => p.title === "Hot Wheels RLC Test Product"));
  assert.ok(candidates.every(p => p.url.startsWith("https://creations.mattel.com/products/")));
  assert.ok(candidates.every(p => p.variantId));
  assert.ok(h.storage.candidatesUpdated > 0);
});
