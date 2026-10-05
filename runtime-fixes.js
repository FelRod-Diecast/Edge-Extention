/*
 * Runtime safety fixes for scheduled Mattel launches.
 *
 * Mattel's Shopify JSON can report a future product variant as
 * available even while the product page is still "Coming Soon".
 * The tracker must treat a future launch as NOT PURCHASABLE until
 * its scheduled launch timestamp has arrived.
 */
(() => {
  "use strict";

  let scheduledLaunches = new Map();

  async function refreshScheduledLaunches() {
    try {
      const result = await chrome.storage.local.get(["upcomingProducts"]);
      const next = new Map();

      for (const product of result.upcomingProducts || []) {
        if (!product?.handle) continue;

        const timestamp = Number(product.launchTimestamp);
        if (Number.isFinite(timestamp)) {
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

  function suppressFutureLaunchInventory(handle, inventory) {
    const future = getFutureLaunch(handle);

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

  function install() {
    if (typeof self.checkLiveInventory === "function") {
      const originalCheckLiveInventory = self.checkLiveInventory;

      self.checkLiveInventory = async function(handle) {
        if (scheduledLaunches.size === 0) {
          await refreshScheduledLaunches();
        }

        const inventory = await originalCheckLiveInventory(handle);
        return suppressFutureLaunchInventory(handle, inventory);
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
