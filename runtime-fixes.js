/*
 * Runtime safety fixes for scheduled Mattel launches.
 *
 * Mattel's Shopify JSON can report a future product variant as
 * available even while the product page is still "Coming Soon".
 * The tracker must treat a future launch as NOT PURCHASABLE until
 * its scheduled launch timestamp has arrived.
 *
 * The important fallback here is the live Mattel product page. The
 * normal stock scan runs before the Upcoming scan, so relying only on
 * upcomingProducts storage is not sufficient for a newly discovered
 * launch. For RLC / Red Line Club / Elite 64 products that report
 * available=true with no positive inventory quantity, we verify the
 * product page's actual launch date before accepting it as in stock.
 */
(() => {
  "use strict";

  let scheduledLaunches = new Map();
  const pageLaunchCache = new Map();

  async function refreshScheduledLaunches() {
    try {
      const result = await chrome.storage.local.get(["upcomingProducts", "itemsState"]);
      const next = new Map();

      for (const product of Object.values(result.itemsState || {})) {
        if (!product?.handle || product.upcoming !== true) continue;

        const timestamp = Number(
          product.launchTimestamp || product.scheduledLaunchTimestamp
        );

        if (Number.isFinite(timestamp)) {
          next.set(product.handle, {
            timestamp,
            launchDate: product.launchDate || product.scheduledLaunchDate || null
          });
        }
      }

      for (const product of result.upcomingProducts || []) {
        if (!product?.handle) continue;

        const timestamp = Number(product.launchTimestamp);
        if (Number.isFinite(timestamp) && !next.has(product.handle)) {
          next.set(product.handle, {
            timestamp,
            launchDate: product.launchDate || null
          });
        }
      }

      scheduledLaunches = next;
    } catch (err) {
      console.warn("[SCHEDULED STOCK] Could not refresh launch cache:", err);
    }
  }

  function getFutureLaunch(handle) {
    const entry = scheduledLaunches.get(handle);
    if (!entry) return null;

    return entry.timestamp > Date.now() ? entry : null;
  }

  function shouldVerifyProductPage(handle, inventory) {
    if (!inventory?.ok || inventory.available !== true) {
      return false;
    }

    const quantity = Number(inventory.quantity);
    const noPositiveQuantity =
      inventory.quantity === null ||
      inventory.quantity === undefined ||
      !Number.isFinite(quantity) ||
      quantity <= 0;

    if (!noPositiveQuantity) return false;

    const value = String(handle || "").toLowerCase();

    return (
      value.includes("rlc") ||
      value.includes("red-line-club") ||
      value.includes("elite-64") ||
      value.includes("elite64")
    );
  }

  async function detectFutureLaunchFromPage(handle) {
    if (!shouldVerifyProductPage(handle, { ok: true, available: true, quantity: 0 })) {
      return null;
    }

    const cached = pageLaunchCache.get(handle);
    if (cached) {
      if (cached.timestamp > Date.now()) return cached;
      pageLaunchCache.delete(handle);
    }

    try {
      const response = await fetch(
        `https://creations.mattel.com/products/${handle}`,
        { cache: "no-store" }
      );

      if (!response.ok) return null;

      const html = await response.text();
      if (!html || /Page not found/i.test(html)) return null;

      const match = html.match(
        /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i
      );

      if (!match?.[1]) return null;

      const parser = self.parseMattelLaunchDate;
      if (typeof parser !== "function") return null;

      const parsed = parser(match[1]);
      const timestamp = parsed instanceof Date
        ? parsed.getTime()
        : Number(parsed?.timestamp);

      if (!Number.isFinite(timestamp)) return null;

      const entry = {
        timestamp,
        launchDate: parsed?.text || match[1]
      };

      pageLaunchCache.set(handle, entry);

      if (entry.timestamp > Date.now()) {
        scheduledLaunches.set(handle, entry);

        console.log(
          `[SCHEDULED STOCK] Live page confirms future launch for ${handle}: ${entry.launchDate}`
        );

        return entry;
      }

      return null;
    } catch (err) {
      console.warn(
        `[SCHEDULED STOCK] Could not verify launch page for ${handle}:`,
        err
      );
      return null;
    }
  }

  function suppressFutureLaunchInventory(handle, inventory, future) {
    if (!future || !inventory?.ok) {
      return inventory;
    }

    console.log(
      `[SCHEDULED STOCK] ${handle} is scheduled for ${future.launchDate || new Date(future.timestamp).toISOString()}; treating it as NOT PURCHASABLE.`
    );

    return {
      ...inventory,
      available: false,
      quantity: 0,
      variantId: null,
      scheduledLaunchTimestamp: future.timestamp,
      scheduledLaunchDate: future.launchDate
    };
  }

  async function syncTrackedState() {
    try {
      const result = await chrome.storage.local.get(["itemsState"]);
      const state = result.itemsState || {};
      let changed = false;

      for (const item of Object.values(state)) {
        if (!item?.handle) continue;

        const future = getFutureLaunch(item.handle);
        if (!future) continue;

        if (item.available !== false || Number(item.quantity) !== 0) {
          item.available = false;
          item.quantity = 0;
          changed = true;
        }

        item.scheduledLaunchTimestamp = future.timestamp;
        item.scheduledLaunchDate = future.launchDate;
        item.upcoming = true;
      }

      if (changed) {
        await chrome.storage.local.set({ itemsState: state });
        console.log("[SCHEDULED STOCK] Corrected future-launch products in tracked state.");
      }
    } catch (err) {
      console.warn("[SCHEDULED STOCK] Could not sync tracked state:", err);
    }
  }

  // Popup-only tab opener. This is intentionally message-driven and has
  // NO automatic scanner/popout path. A tab is created only after the
  // popup explicitly sends OPEN_USER_TAB from a button click.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action !== "OPEN_USER_TAB") return;

    const requestedUrl = typeof msg.url === "string" ? msg.url.trim() : "";
    const handle = typeof msg.handle === "string" ? msg.handle.trim() : "";
    const requestedVariant = Number(msg.variantId);
    const qty = Math.min(10, Math.max(1, Number(msg.qty) || 1));

    (async () => {
      let url = requestedUrl;

      if (msg.checkout === true) {
        let variantId = Number.isFinite(requestedVariant) && requestedVariant > 0
          ? requestedVariant
          : null;

        if (!variantId && handle) {
          try {
            const response = await fetch(
              `https://creations.mattel.com/products/${handle}.js`,
              { cache: "no-store" }
            );

            if (response.ok) {
              const data = await response.json();
              variantId = Number(data?.variants?.[0]?.id) || null;
            }
          } catch (err) {
            console.error("[POPUP LINKS] Failed to fetch checkout variant:", err);
          }
        }

        if (variantId) {
          url = `https://creations.mattel.com/cart/${variantId}:${qty}`;
        }
      }

      if (!/^https:\/\/creations\.mattel\.com\//i.test(url)) {
        sendResponse({ ok: false, error: "Invalid Mattel URL" });
        return;
      }

      try {
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();

    return true;
  });

  function install() {
    if (typeof self.checkLiveInventory === "function") {
      const originalCheckLiveInventory = self.checkLiveInventory;

      self.checkLiveInventory = async function(handle) {
        if (scheduledLaunches.size === 0) {
          await refreshScheduledLaunches();
        }

        const inventory = await originalCheckLiveInventory(handle);

        let future = getFutureLaunch(handle);

        if (!future && shouldVerifyProductPage(handle, inventory)) {
          future = await detectFutureLaunchFromPage(handle);
        }

        return suppressFutureLaunchInventory(handle, inventory, future);
      };
    }

    if (typeof self.scanUpcomingProducts === "function") {
      const originalScanUpcoming = self.scanUpcomingProducts;

      self.scanUpcomingProducts = async function(...args) {
        const result = await originalScanUpcoming.apply(this, args);
        await refreshScheduledLaunches();
        await syncTrackedState();
        return result;
      };
    }

    refreshScheduledLaunches().then(syncTrackedState);
    console.log("[SCHEDULED STOCK] Future-launch inventory protection installed");
  }

  if (typeof queueMicrotask === "function") {
    queueMicrotask(install);
  } else {
    Promise.resolve().then(install);
  }
})();
