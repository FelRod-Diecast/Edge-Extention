/*
 * Popup display fixes:
 * 1) Never show a scheduled future launch in an In Stock category.
 * 2) Sort normal product lists by newest Shopify product id first,
 *    falling back to stored timestamps when an id is unavailable.
 *
 * Upcoming / Hidden / Restock / Sold Out History keep their own ordering.
 */
(() => {
  "use strict";

  const NORMAL_LIST_TITLES = new Set([
    "Dashboard Results",
    "🟢 In Stock Products",
    "🏁 RLC In Stock",
    "💎 Elite 64 In Stock",
    "🔥 Premium In Stock",
    "📦 Other In Stock"
  ]);

  let productCache = [];
  let sorting = false;

  function numericId(product) {
    const value = Number(product?.id);
    return Number.isFinite(value) ? value : 0;
  }

  function timestamp(product) {
    const candidates = [
      product?.publishedAt,
      product?.published_at,
      product?.addedDate,
      product?.stats?.firstSeen
    ];

    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) return value;

      if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;

        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }

    return 0;
  }

  async function refreshCache() {
    try {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: "getDashboardData" }, resolve);
      });
      productCache = response?.products || [];
    } catch (_) {
      productCache = [];
    }
  }

  function isFutureLaunch(product) {
    const timestampValue = Number(product?.scheduledLaunchTimestamp || product?.launchTimestamp);
    return Number.isFinite(timestampValue) && timestampValue > Date.now();
  }

  function applyFutureLaunchGuard() {
    const title = document.getElementById("resultsTitle")?.textContent?.trim() || "";
    if (!NORMAL_LIST_TITLES.has(title)) return;

    const futureTitles = new Set(
      productCache
        .filter(isFutureLaunch)
        .map(product => String(product.title || "").trim())
        .filter(Boolean)
    );

    if (!futureTitles.size) return;

    const container = document.getElementById("resultsContainer");
    if (!container) return;

    for (const card of container.querySelectorAll(".product-card")) {
      const titleNode = card.querySelector(".product-title");
      const titleText = titleNode?.textContent?.trim() || "";

      if (!futureTitles.has(titleText)) continue;

      // Remove the card from a normal in-stock view. Do not touch
      // the dedicated Upcoming view.
      card.remove();
    }
  }

  function sortNormalCards() {
    if (sorting) return;

    const title = document.getElementById("resultsTitle")?.textContent?.trim() || "";
    if (!NORMAL_LIST_TITLES.has(title)) return;

    const container = document.getElementById("resultsContainer");
    if (!container) return;

    const cards = [...container.querySelectorAll(".product-card")];
    if (cards.length < 2) return;

    const byTitle = new Map();
    for (const product of productCache) {
      const key = String(product.title || "").trim();
      if (key && !byTitle.has(key)) byTitle.set(key, product);
    }

    const ranked = cards.map((card, index) => {
      const titleText = card.querySelector(".product-title")?.textContent?.trim() || "";
      const product = byTitle.get(titleText);

      return {
        card,
        index,
        id: numericId(product),
        time: timestamp(product)
      };
    });

    ranked.sort((a, b) => {
      if (a.id && b.id && a.id !== b.id) return b.id - a.id;
      if (a.time !== b.time) return b.time - a.time;
      return a.index - b.index;
    });

    sorting = true;
    const fragment = document.createDocumentFragment();
    for (const entry of ranked) fragment.appendChild(entry.card);
    container.appendChild(fragment);
    sorting = false;
  }

  async function refreshAndFix() {
    await refreshCache();
    applyFutureLaunchGuard();
    sortNormalCards();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("resultsContainer");
    if (!container) return;

    const observer = new MutationObserver(() => {
      if (sorting) return;
      setTimeout(() => {
        refreshAndFix();
      }, 0);
    });

    observer.observe(container, { childList: true, subtree: true });

    refreshAndFix();
  });
})();
