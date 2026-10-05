/*
 * Smart Upcoming + Hidden discovery
 *
 * Loaded from config.js before background.js finishes evaluating.
 * The microtask patch runs after background.js has initialized its
 * existing globals, replacing only the two discovery scanners.
 * Existing alert/cooldown/state helpers are intentionally reused.
 */

(() => {
  "use strict";

  const MATTEL = "https://creations.mattel.com";
  const PRODUCT_LIMIT = 250;
  const MAX_PRODUCT_PAGES = 12;
  const MAX_PAGE_CHECKS = 80;
  const CHECK_CONCURRENCY = 6;

  const DISCOVERY_SOURCES = [
    `${MATTEL}/pages/launch-calendar`,
    `${MATTEL}/pages/hot-wheels-collectors`,
    `${MATTEL}/collections/hot-wheels`,
    `${MATTEL}/collections/red-line-club`,
    `${MATTEL}/collections/elite-64`,
    `${MATTEL}/collections/new-arrivals`
  ];

  const BLOCKED_WORDS = [
    "shirt", "t-shirt", "tee", "hoodie", "sweatshirt", "sweater",
    "jacket", "zip-jacket", "windbreaker", "pullover", "fleece",
    "crewneck", "jersey", "hat", "beanie", "mug", "tumbler", "cup",
    "drinkware", "blanket", "sticker", "pin", "keychain", "poster",
    "print", "lithograph", "tote", "backpack", "bag", "pants", "glass",
    "luggage", "tag", "barbie", "formula-1-team"
  ];

  const STRONG_VEHICLE_WORDS = [
    "hot-wheels", "hot wheels", "rlc", "red-line-club", "red line club",
    "elite-64", "elite 64", "boulevard", "team-transport", "car-culture",
    "diecast", "die-cast", "die cast", "blazer", "silverado", "skyline",
    "mustang", "porsche", "ferrari", "nissan", "chevrolet", "chevy",
    "dodge", "ford", "toyota", "datsun", "pontiac", "mazda"
  ];

  const SOLD_OUT_RE = /\b(?:sold\s*out|sold-out|out\s*of\s*stock|unavailable)\b/i;
  const LAUNCH_PATTERNS = [
    /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i,
    /Launch(?:es|ing)?\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i,
    /([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)\s*(?:Launch|Drop)/i
  ];

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function isBlocked(value) {
    const s = lower(value);
    return BLOCKED_WORDS.some(word => s.includes(word));
  }

  function isHotWheelsCandidate(product) {
    if (!product || isBlocked(`${product.handle || ""} ${product.title || ""}`)) {
      return false;
    }

    const haystack = lower(`${product.handle || ""} ${product.title || ""} ${(product.tags || []).join(" ")}`);
    return STRONG_VEHICLE_WORDS.some(word => haystack.includes(word));
  }

  function parseMattelLaunchDate(value) {
    const raw = text(value).replace(/\u00a0/g, " ");
    if (!raw) return null;

    const match = raw.match(/([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(am|pm)\s*PT)/i);
    if (!match) return null;

    const [, datePart, ampm] = match;
    const normalized = datePart.replace(/\s+/g, " ").trim();
    const withoutTz = normalized.replace(/\s*PT$/i, "");

    const parsed = new Date(withoutTz);
    if (Number.isNaN(parsed.getTime())) return null;

    // Mattel publishes these times in Pacific Time. Convert the displayed
    // wall-clock value to the correct America/Los_Angeles instant instead
    // of relying on the service worker's local timezone.
    const parts = withoutTz.match(/^(\w+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!parts) return null;

    let hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const meridiem = parts[6].toLowerCase();
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const monthIndex = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    }[parts[1].toLowerCase()];

    if (monthIndex === undefined) return null;

    // Determine the Pacific UTC offset for this date. Noon UTC is sufficient
    // to identify whether the date is in PDT or PST, then rebuild the exact
    // launch instant from the Pacific wall clock.
    const probe = new Date(Date.UTC(Number(parts[3]), monthIndex, Number(parts[2]), 20, 0, 0));
    const pacificParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      timeZoneName: "shortOffset",
      year: "numeric"
    }).formatToParts(probe);
    const offsetPart = pacificParts.find(p => p.type === "timeZoneName")?.value || "GMT-8";
    const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    const offsetMinutes = offsetMatch
      ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] || 0)) * (offsetMatch[1] === "+" ? 1 : -1)
      : -480;

    const utcMs = Date.UTC(Number(parts[3]), monthIndex, Number(parts[2]), hour, minute) - offsetMinutes * 60000;
    const result = new Date(utcMs);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function extractLaunchDate(html) {
    for (const regex of LAUNCH_PATTERNS) {
      const match = String(html || "").match(regex);
      if (match?.[1]) {
        const parsed = parseMattelLaunchDate(match[1]);
        if (parsed) return { text: text(match[1]), timestamp: parsed.getTime() };
      }
    }
    return null;
  }

  function extractShippingEta(html) {
    const match = String(html || "").match(/(?:ships?|expected\s+to\s+ship|shipping\s+by|ships\s+on\s+or\s+before)\s+([^<.]{3,100})/i);
    return match ? text(match[1]) : null;
  }

  function extractHandles(html) {
    const handles = new Set();
    const re = /\/products\/([a-z0-9][a-z0-9-]{1,150})(?:[?#"'\\/]|$)/gi;
    let match;
    while ((match = re.exec(String(html || "")))) handles.add(match[1].toLowerCase());
    return [...handles];
  }

  async function fetchText(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.text();
    } catch (_) {
      return null;
    }
  }

  async function fetchJson(url) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  async function fetchCatalogProducts() {
    const products = [];

    for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
      const data = await fetchJson(`${MATTEL}/products.json?limit=${PRODUCT_LIMIT}&page=${page}`);
      if (!Array.isArray(data?.products) || !data.products.length) break;
      products.push(...data.products);
      if (data.products.length < PRODUCT_LIMIT) break;
    }

    return products;
  }

  async function fetchDiscoveryHandles() {
    const handles = new Set();

    const pages = await Promise.all(DISCOVERY_SOURCES.map(fetchText));
    for (const html of pages) {
      for (const handle of extractHandles(html || "")) handles.add(handle);
    }

    return handles;
  }

  async function mapLimit(values, limit, worker) {
    const results = new Array(values.length);
    let next = 0;

    async function runner() {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        try {
          results[index] = await worker(values[index], index);
        } catch (_) {
          results[index] = null;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runner));
    return results;
  }

  function upcomingCategory(launchTime, now) {
    const days = Math.ceil((launchTime - now) / 86400000);
    if (launchTime <= now) return "LIVE WINDOW";
    if (days <= 7) return "NEXT 7 DAYS";
    if (days <= 30) return "30 DAYS";
    if (days <= 60) return "60 DAYS";
    if (days <= 90) return "90 DAYS";
    return "90+ DAYS";
  }

  async function smartScanUpcomingProducts() {
    const now = Date.now();
    console.log("[UPCOMING] Smart Mattel scan starting...");

    const storedResult = await chrome.storage.local.get(["upcomingProducts"]);
    const storedUpcoming = Array.isArray(storedResult.upcomingProducts) ? storedResult.upcomingProducts : [];
    const storedByHandle = new Map(storedUpcoming.filter(p => p?.handle).map(p => [p.handle, p]));

    const [catalog, sourceHandles] = await Promise.all([
      fetchCatalogProducts(),
      fetchDiscoveryHandles()
    ]);

    const candidates = new Map();
    for (const product of catalog) {
      if (product?.handle && isHotWheelsCandidate(product)) candidates.set(product.handle, product);
    }
    for (const handle of sourceHandles) {
      if (!candidates.has(handle) && !isBlocked(handle)) candidates.set(handle, { handle });
    }
    for (const stored of storedUpcoming) {
      if (stored?.handle && !isBlocked(stored.handle)) candidates.set(stored.handle, { ...candidates.get(stored.handle), ...stored });
    }

    const handles = [...candidates.keys()].slice(0, MAX_PAGE_CHECKS);
    const inspected = await mapLimit(handles, CHECK_CONCURRENCY, async handle => {
      const product = candidates.get(handle) || { handle };
      const html = await fetchText(`${MATTEL}/products/${handle}`);
      if (!html || /Page not found/i.test(html)) return null;

      const launch = extractLaunchDate(html);
      if (!launch) return null;

      const live = await checkLiveInventory(handle);
      if (live?.ok === true && live.available === true) return null;

      const titleMatch = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
      const title = text(titleMatch?.[1] || product.title || handle).replace(/\s*\|\s*Mattel.*$/i, "");
      const stored = storedByHandle.get(handle);

      const existingAlert = hiddenSeen[`UPCOMING_LAUNCH_upcoming_${handle}`] || hiddenSeen[`upcoming_${handle}`];
      const alertTime = Number(existingAlert?.timestamp);
      const wasKnownBeforeRelease = Boolean(existingAlert?.alerted && Number.isFinite(alertTime) && alertTime <= launch.timestamp);

      if (launch.timestamp <= now && !wasKnownBeforeRelease) return null;

      return {
        ...stored,
        ...product,
        handle,
        title,
        url: `${MATTEL}/products/${handle}`,
        launchDate: launch.text,
        launchTimestamp: launch.timestamp,
        daysUntilLaunch: launch.timestamp <= now ? 0 : Math.ceil((launch.timestamp - now) / 86400000),
        upcomingCategory: upcomingCategory(launch.timestamp, now),
        upcomingConfidence: 100,
        upcomingLastChecked: now,
        upcoming: true
      };
    });

    const upcomingProducts = inspected.filter(Boolean).sort((a, b) => (a.launchTimestamp || Infinity) - (b.launchTimestamp || Infinity));

    for (const product of upcomingProducts) {
      if (product.launchTimestamp <= now) continue;
      const key = `upcoming_${product.handle}`;
      if (canAlertItem(key, "UPCOMING_LAUNCH")) {
        notifyBrowser("🚀 UPCOMING LAUNCH", product.title, product.url, false);
        sendWebhookEmbed({
          title: "🚀 UPCOMING LAUNCH",
          description: product.title,
          url: product.url,
          color: 16753920,
          thumbnail: { url: product.image || "" },
          fields: [{ name: "Launch", value: product.launchDate }],
          timestamp: new Date().toISOString()
        });
      }
    }

    saveUpcoming(upcomingProducts);
    console.log(`[UPCOMING] Smart scan found ${upcomingProducts.length} upcoming products`);
  }

  function hiddenScore(product, html, launch) {
    const haystack = lower(`${product.handle || ""} ${product.title || ""} ${(product.tags || []).join(" ")}`);
    const page = lower(html);
    let score = 0;
    const signals = [];

    if (haystack.includes("rlc") || haystack.includes("red line club")) { score += 40; signals.push("RLC"); }
    if (haystack.includes("elite 64") || haystack.includes("elite-64")) { score += 40; signals.push("Elite 64"); }
    if (haystack.includes("hot wheels") || haystack.includes("hot-wheels")) { score += 25; signals.push("Hot Wheels"); }
    if (launch) { score += 25; signals.push("Launch date"); }
    if (/add\s*to\s*cart|add-to-cart|buy\s*now|pre[- ]?order|reserve/i.test(page)) { score += 20; signals.push("Purchase signal"); }
    if (/ships?\s+(?:on|by)|expected\s+to\s+ship|shipping\s+by/i.test(page)) { score += 10; signals.push("Shipping ETA"); }
    if (/sold\s*out|out\s+of\s+stock|unavailable/i.test(page)) { score -= 80; signals.push("Sold out"); }
    if (isBlocked(haystack)) { score -= 100; signals.push("Non-vehicle"); }

    return { score, signals };
  }

  async function smartScanHiddenProducts() {
    console.log("[HIDDEN] Smart Mattel discovery scan starting...");

    const [catalog, sourceHandles] = await Promise.all([
      fetchCatalogProducts(),
      fetchDiscoveryHandles()
    ]);

    const candidates = new Map();
    for (const product of catalog) {
      if (product?.handle && isHotWheelsCandidate(product)) candidates.set(product.handle, product);
    }
    for (const handle of sourceHandles) {
      if (!candidates.has(handle) && !isBlocked(handle)) candidates.set(handle, { handle });
    }

    // Hidden means it is not already part of the extension's tracked state.
    const untracked = [...candidates.values()].filter(product => {
      const handle = product.handle;
      return handle && !Object.values(itemsState).some(item => item?.handle === handle);
    }).slice(0, MAX_PAGE_CHECKS);

    const inspected = await mapLimit(untracked, CHECK_CONCURRENCY, async product => {
      const html = await fetchText(`${MATTEL}/products/${product.handle}`);
      if (!html || /Page not found/i.test(html)) return null;

      const launch = extractLaunchDate(html);
      const scoreData = hiddenScore(product, html, launch);
      if (scoreData.score < 70 || SOLD_OUT_RE.test(html)) return null;

      const titleMatch = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
      const title = text(titleMatch?.[1] || product.title || product.handle).replace(/\s*\|\s*Mattel.*$/i, "");
      const shippingEta = extractShippingEta(html);
      const variantMatch = html.match(/"variantId"\s*:\s*(\d+)/i) || html.match(/variant_id=(\d+)/i);
      const variantId = variantMatch?.[1] || null;
      const directCartUrl = variantId ? `${MATTEL}/cart/${variantId}:1` : `${MATTEL}/products/${product.handle}`;
      const live = await checkLiveInventory(product.handle);

      return {
        ...product,
        handle: product.handle,
        title,
        url: `${MATTEL}/products/${product.handle}`,
        directCartUrl,
        hiddenDiscovery: true,
        hiddenConfidence: Math.min(100, scoreData.score),
        hiddenSignals: scoreData.signals,
        launchDate: launch?.text || null,
        launchTimestamp: launch?.timestamp || null,
        shippingEta,
        liveAvailable: live?.ok === true ? live.available : null,
        firstSeen: new Date().toISOString()
      };
    });

    const hiddenProducts = inspected.filter(Boolean).sort((a, b) => (b.hiddenConfidence || 0) - (a.hiddenConfidence || 0));

    for (const product of hiddenProducts) {
      if (!canAlertItem(product.handle, "HIDDEN_NEW_DISCOVERY")) continue;
      notifyBrowser("👻 NEW HIDDEN DROP FOUND", product.title, product.directCartUrl, true);
      sendWebhookEmbed({
        title: "👻 NEW HIDDEN DROP FOUND",
        description: `**[${product.title}](${product.url})**\
\
⚡ **[DIRECT CHECKOUT LINK](${product.directCartUrl})**`,
        url: product.url,
        color: 8711167,
        fields: [
          { name: "Confidence", value: `${product.hiddenConfidence}/100`, inline: true },
          { name: "Signals", value: product.hiddenSignals.join(", ") || "Verified", inline: true },
          { name: "Launch Date", value: product.launchDate || "Upcoming", inline: true },
          { name: "Shipping ETA", value: product.shippingEta || "Standard", inline: true },
          { name: "🛒 Quick Checkout", value: `[Instant Add to Cart](${product.directCartUrl})`, inline: true }
        ],
        timestamp: new Date().toISOString()
      });
    }

    saveHidden(hiddenProducts);
    console.log(`[HIDDEN] Smart scan found ${hiddenProducts.length} verified hidden opportunities`);
  }

  function install() {
    if (typeof self.scanUpcomingProducts === "function") {
      self.scanUpcomingProducts = smartScanUpcomingProducts;
    }
    if (typeof self.scanHiddenProducts === "function") {
      self.scanHiddenProducts = smartScanHiddenProducts;
    }
    self.parseMattelLaunchDate = parseMattelLaunchDate;
    console.log("[SMART DISCOVERY] Upcoming + Hidden scanners installed");
  }

  // background.js imports config.js before its own function declarations run.
  // The microtask executes after the current script finishes evaluating, before
  // Chrome can dispatch the next alarm/startup event.
  if (typeof queueMicrotask === "function") {
    queueMicrotask(install);
  } else {
    Promise.resolve().then(install);
  }
})();
