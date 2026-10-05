/*
 * Popup display fixes.
 *
 * Keeps the popup's existing rendering and sorting behavior, but makes
 * product-card actions reliable across every normal dashboard view.
 *
 * IMPORTANT: this file never opens tabs by itself. It only responds to an
 * actual user click and asks the background worker to create that one tab.
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

  function normalizeTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function productForCard(card) {
    const title = normalizeTitle(
      card.querySelector(".product-title")?.textContent
    );

    if (!title) return null;

    const sources = [];

    if (Array.isArray(currentView)) sources.push(currentView);
    if (Array.isArray(allProducts)) sources.push(allProducts);

    for (const products of sources) {
      const exact = products.find(product =>
        normalizeTitle(product?.title) === title
      );

      if (exact) return exact;
    }

    const compactTitle = title.replace(/[^a-z0-9]+/g, "");

    for (const products of sources) {
      const relaxed = products.find(product => {
        const candidate = normalizeTitle(product?.title).replace(/[^a-z0-9]+/g, "");
        return candidate && candidate === compactTitle;
      });

      if (relaxed) return relaxed;
    }

    return null;
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

  function sendUserTab(message) {
    // Do not wait for the popup to remain open. The service worker owns
    // the actual tab creation, so the user's click survives popup closure.
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          console.error(
            "[POPUP LINKS] Message failed:",
            chrome.runtime.lastError.message
          );
          return;
        }

        if (!response?.ok) {
          console.error(
            "[POPUP LINKS] Background tab open failed:",
            response?.error || "Unknown error"
          );
        }
      });
    } catch (err) {
      console.error("[POPUP LINKS] Failed to send tab request:", err);
    }
  }

  function openProductUrl(product, fallbackUrl) {
    const url = product?.url || fallbackUrl;
    if (!url) {
      console.error("[POPUP LINKS] Product has no URL:", product);
      return;
    }

    sendUserTab({
      action: "OPEN_USER_TAB",
      url
    });
  }

  function openDirectCheckout(product, qty) {
    sendUserTab({
      action: "OPEN_USER_TAB",
      checkout: true,
      handle: product?.handle || "",
      variantId: product?.variantId || product?.variants?.[0]?.id || null,
      qty,
      url: product?.url || ""
    });
  }

  function installLinkHandlers() {
    const container = document.getElementById("resultsContainer");
    if (!container) return;

    container.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;

      const card = button.closest(".product-card");
      if (!card) return;

      const isView = button.classList.contains("product-link");
      const isCheckout = button.textContent?.includes("Direct Checkout");

      if (!isView && !isCheckout) return;

      // Capture phase stops popup.js from running its original window.open().
      event.preventDefault();
      event.stopImmediatePropagation();

      const product = productForCard(card);
      if (!product) {
        console.error(
          "[POPUP LINKS] Could not match clicked card to product.",
          card.querySelector(".product-title")?.textContent
        );
        return;
      }

      if (isView) {
        openProductUrl(product);
        return;
      }

      const qtyInput = card.querySelector('input[type="number"]');
      const qty = Math.min(
        10,
        Math.max(1, parseInt(qtyInput?.value, 10) || 1)
      );

      button.textContent = "⏳ Opening...";
      openDirectCheckout(product, qty);
      setTimeout(() => {
        if (button.isConnected) button.textContent = "⚡ Direct Checkout";
      }, 500);
    }, true);
  }

  function install() {
    installLinkHandlers();

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
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
