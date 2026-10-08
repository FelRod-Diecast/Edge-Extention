const MATTEL = "https://creations.mattel.com";
const CHECK_INTERVAL_MINUTES = 0.5;
const DISCOVERY_INTERVAL_MINUTES = 5;

let selected = {};
let checking = false;

async function loadState() {
  const data = await chrome.storage.local.get(["raceAssistProducts"]);
  selected = data.raceAssistProducts || {};
}

async function saveState() {
  await chrome.storage.local.set({ raceAssistProducts: selected });
}

function normalizeProduct(p) {
  return {
    handle: p.handle,
    title: p.title || p.handle,
    url: p.url || MATTEL + "/products/" + p.handle,
    launchDate: p.launchDate || null,
    launchTimestamp: p.launchTimestamp || null,
    variantId: p.variantId ? String(p.variantId) : null,
    assistance: p.assistance !== false,
    status: p.status || "WATCHING",
    lastChecked: p.lastChecked || 0,
    lastError: null
  };
}

async function getProduct(handle) {
  const response = await fetch(MATTEL + "/products/" + handle + ".js", {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const data = await response.json();
  const variant = (data.variants || []).find(v => v.available) || data.variants?.[0];
  return {
    title: data.title || handle,
    handle,
    url: MATTEL + "/products/" + handle,
    variantId: variant?.id ? String(variant.id) : null,
    available: Boolean(variant?.available)
  };
}

function cartUrl(variantId) {
  return MATTEL + "/cart/" + variantId + ":2";
}

async function openAssistant(product) {
  const url = chrome.runtime.getURL(
    "assistant.html?handle=" + encodeURIComponent(product.handle)
  );
  await chrome.windows.create({
    url,
    type: "popup",
    width: 430,
    height: 700,
    focused: true
  });
}

async function openCheckout(product) {
  if (!product.variantId) return;
  await chrome.windows.create({
    url: cartUrl(product.variantId),
    type: "popup",
    width: 500,
    height: 750,
    focused: true
  });
}

async function checkSelected() {
  if (checking) return;
  checking = true;
  try {
    const entries = Object.values(selected).filter(p => p.assistance);
    for (const saved of entries) {
      try {
        const live = await getProduct(saved.handle);
        saved.title = live.title;
        saved.url = live.url;
        saved.variantId = live.variantId;
        saved.lastChecked = Date.now();
        saved.lastError = null;

        if (live.available && live.variantId && saved.status !== "AVAILABLE") {
          saved.status = "AVAILABLE";
          await saveState();
          await chrome.notifications.create("race_" + saved.handle, {
            type: "basic",
            title: "RLC Race Assist — AVAILABLE",
            message: saved.title + " is available. Quantity 2 checkout opened.",
            priority: 2
          });
          await openAssistant(saved);
          await openCheckout(saved);
        } else if (!live.available) {
          saved.status = "WATCHING";
          await saveState();
        }
      } catch (error) {
        saved.lastError = String(error?.message || error);
        saved.lastChecked = Date.now();
        await saveState();
      }
    }
  } finally {
    checking = false;
  }
}

async function discoverCandidates() {
  const candidates = [];
  const sources = [
    MATTEL + "/collections/red-line-club",
    MATTEL + "/pages/launch-calendar"
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const html = await response.text();
      const re = /\/products\/([a-z0-9][a-z0-9-]{1,150})/gi;
      let match;
      const seen = new Set();

      while ((match = re.exec(html)) && candidates.length < 100) {
        const handle = match[1].toLowerCase();
        if (seen.has(handle)) continue;
        seen.add(handle);
        if (!/(rlc|red-line-club|elite-64)/i.test(handle)) continue;
        candidates.push({
          handle,
          title: handle.replace(/-/g, " "),
          url: MATTEL + "/products/" + handle
        });
      }
    } catch (_) {}
  }

  const unique = [...new Map(candidates.map(p => [p.handle, p])).values()];
  await chrome.storage.local.set({
    raceAssistCandidates: unique,
    candidatesUpdated: Date.now()
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await loadState();

    if (message?.action === "getState") {
      sendResponse({ products: Object.values(selected) });
      return;
    }

    if (message?.action === "getCandidates") {
      const data = await chrome.storage.local.get(["raceAssistCandidates", "candidatesUpdated"]);
      sendResponse({
        products: data.raceAssistCandidates || [],
        updated: data.candidatesUpdated || 0
      });
      return;
    }

    if (message?.action === "setAssistance") {
      const product = normalizeProduct(message.product);
      product.assistance = Boolean(message.enabled);
      product.status = product.assistance ? "WATCHING" : "DISABLED";
      selected[product.handle] = product;
      await saveState();
      sendResponse({ ok: true, product });
      return;
    }

    if (message?.action === "removeProduct") {
      delete selected[message.handle];
      await saveState();
      sendResponse({ ok: true });
      return;
    }

    if (message?.action === "testAssistant") {
      await openAssistant(normalizeProduct(message.product));
      sendResponse({ ok: true });
      return;
    }

    if (message?.action === "checkNow") {
      await checkSelected();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown action" });
  })().catch(error => sendResponse({
    ok: false,
    error: String(error?.message || error)
  }));
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "race-assist-check") {
    await loadState();
    await checkSelected();
  }
  if (alarm.name === "race-assist-discovery") {
    await discoverCandidates();
  }
});

(async () => {
  await loadState();
  await discoverCandidates();
  chrome.alarms.create("race-assist-check", { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.create("race-assist-discovery", { periodInMinutes: DISCOVERY_INTERVAL_MINUTES });
})();