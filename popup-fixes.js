/*
 * Popup display fixes.
 *
 * The original popup renderer sorts several views by stats.firstSeen.
 * That is tracker-discovery order, not product recency, so old items
 * can stay ahead of newly added Mattel products forever.
 *
 * This file corrects the rendered card order after popup.js renders it.
 * It uses the already-loaded allProducts array from popup.js instead of
 * requesting dashboard data again, so the sort is based on the exact
 * product objects the popup is displaying.
 *
 * Dedicated views keep their intentional ordering:
 * Upcoming, Hidden, Restocks, and Sold Out History.
 */
(() => {
  "use strict";

  const SORT_NEWEST_FIRST = new Set([
    "Dashboard Results",
    "🟢 In Stock Products",
    "🏁 RLC In Stock",
    "💎 Elite 64 In Stock",
    "🔥 Premium In Stock",
    "📦 Other In Stock"
  ]);

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
      product?.createdAt,
      product?.created_at,
      product?.stats?.firstSeen
    ];

    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;

        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }

    return 0;
  }

  function productForCard(card) {
    const title = card.querySelector(".product-title")?.textContent?.trim() || "";
    if (!title || !Array.isArray(allProducts)) return null;

    return allProducts.find(product =>
      String(product?.title || "").trim() === title
    ) || null;
  }

  function sortRenderedCards() {
    if (sorting) return;

    const title = document.getElementById("resultsTitle")?.textContent?.trim() || "";
    if (!SORT_NEWEST_FIRST.has(title)) return;

    const container = document.getElementById("resultsContainer");
    if (!container) return;

    const cards = [...container.querySelectorAll(".product-card")];
    if (cards.length < 2) return;

    const ranked = cards.map((card, index) => {
      const product = productForCard(card);

      return {
        card,
        index,
        id: numericId(product),
        time: timestamp(product)
      };
    });

    ranked.sort((a, b) => {
      // Shopify product IDs increase as products are created, so this is
      // the primary recency signal. Stored timestamps are only a fallback.
      if (a.id && b.id && a.id !== b.id) {
        return b.id - a.id;
      }

      if (a.time !== b.time) {
        return b.time - a.time;
      }

      return a.index - b.index;
    });

    sorting = true;

    const fragment = document.createDocumentFragment();
    for (const entry of ranked) {
      fragment.appendChild(entry.card);
    }

    container.appendChild(fragment);
    sorting = false;
  }

  function installObserver() {
    const container = document.getElementById("resultsContainer");
    if (!container) return;

    const observer = new MutationObserver(() => {
      if (sorting) return;
      setTimeout(sortRenderedCards, 0);
    });

    observer.observe(container, {
      childList: true,
      subtree: true
    });

    setTimeout(sortRenderedCards, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installObserver, { once: true });
  } else {
    installObserver();
  }
})();
