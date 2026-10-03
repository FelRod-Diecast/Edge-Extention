let allProducts = [];
let currentView = [];

// --- SETTINGS PANEL LOGIC ---
function setupSettingsPanel() {
  const popoutMode = document.getElementById("popoutMode");
  const popoutKeywords = document.getElementById("popoutKeywords");
  const soundEnabled = document.getElementById("soundEnabled");
  const saveBtn = document.getElementById("saveSettingsBtn");
  const testSoundBtn = document.getElementById("testSoundBtn");
  const saveStatus = document.getElementById("saveStatus");

  if (!saveBtn) return; // Guard in case settings HTML is omitted

  // 1. Load existing saved settings from chrome.storage.local
  chrome.storage.local.get(["popoutMode", "popoutKeywords", "soundEnabled"], (res) => {
    if (res.popoutMode) popoutMode.value = res.popoutMode;
    if (res.popoutKeywords) popoutKeywords.value = res.popoutKeywords;
    if (typeof res.soundEnabled !== "undefined") soundEnabled.checked = res.soundEnabled;
  });

  // 2. Save settings when 'Save Settings' button is clicked
  saveBtn.addEventListener("click", () => {
    chrome.storage.local.set({
      popoutMode: popoutMode.value,
      popoutKeywords: popoutKeywords.value,
      soundEnabled: soundEnabled.checked
    }, () => {
      saveStatus.textContent = "✔ Settings saved!";
      setTimeout(() => { saveStatus.textContent = ""; }, 2500);
    });
  });

  // 3. Test Audio Alert via background/offscreen worker
  testSoundBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "PLAY_ALERT_SOUND" });
  });
}

function getUpcomingProducts() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        action: "getUpcomingProducts"
      },
      resolve
    );
  });
}

function getHiddenProducts() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        action: "getHiddenProducts"
      },
      resolve
    );
  });
}

function getDashboardData() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "getDashboardData" },
      resolve
    );
  });
}

function scanNow() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      "scanNow",
      resolve
    );
  });
}

function updateCounters(stats, products) {
  // Filter for items that are strictly available & have stock/price
  const availableItems = products.filter(p => p.available && !p.hiddenDiscovery);
  const soldOutItems = products.filter(p => !p.available && !p.hiddenDiscovery);

  const rlcInStock = availableItems.filter(p => (p.title || "").toLowerCase().includes("rlc"));
  const elite64InStock = availableItems.filter(p => (p.title || "").toLowerCase().includes("elite 64"));
  const premiumInStock = availableItems.filter(p => (p.title || "").toLowerCase().includes("premium"));

  const otherInStock = availableItems.filter(p => {
    const title = (p.title || "").toLowerCase();
    return !title.includes("rlc") &&
           !title.includes("elite 64") &&
           !title.includes("premium");
  });

  const inStockEl = document.getElementById("inStockCount") || document.getElementById("activeStockCount");
  if (inStockEl) inStockEl.textContent = availableItems.length;

  if (document.getElementById("rlcCount")) document.getElementById("rlcCount").textContent = rlcInStock.length;
  if (document.getElementById("elite64Count")) document.getElementById("elite64Count").textContent = elite64InStock.length;
  if (document.getElementById("premiumCount")) document.getElementById("premiumCount").textContent = premiumInStock.length;
  if (document.getElementById("otherCount")) document.getElementById("otherCount").textContent = otherInStock.length;
  if (document.getElementById("soldOutCount")) document.getElementById("soldOutCount").textContent = soldOutItems.length;

  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentRestocks = products.filter(p =>
    p.available === true &&
    !p.hiddenDiscovery &&
    p.stats?.restockTimestamps?.some(time => time >= oneWeekAgo)
  );

  if (document.getElementById("restockCount")) {
    document.getElementById("restockCount").textContent = recentRestocks.length;
  }

  getUpcomingProducts().then(response => {
    const upcomingEl = document.getElementById("upcomingCount");
    if (upcomingEl) upcomingEl.textContent = (response.products || []).length;
  });

  getHiddenProducts().then(response => {
    const hidden = response.products || [];
    const hiddenCount = document.getElementById("hiddenCount");
    if (hiddenCount) hiddenCount.textContent = hidden.length;
  });
}


// ============================================================
// CENTRAL PRODUCT SORTING
// Newest products first based on stats.firstSeen.
// Every normal product list uses this automatically.
// ============================================================
function getProductTimestamp(product) {
  const value = product?.stats?.firstSeen;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    const parsedDate = Date.parse(value);

    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return 0;
}

function sortProductsNewestFirst(products) {
  return [...products].sort((a, b) => {
    const aFirstSeen = getProductTimestamp(a);
    const bFirstSeen = getProductTimestamp(b);

    return bFirstSeen - aFirstSeen;
  });
}


// ============================================================
// RENDER PRODUCTS
// preserveOrder = true is used only when a list has its own
// intentional ordering, such as Hidden confidence or
// Sold Out History by most recent sellout.
// ============================================================
function renderProducts(products, title, preserveOrder = false) {
  products = preserveOrder
    ? products
    : sortProductsNewestFirst(products);

  document.getElementById("resultsTitle").textContent = title;

  const container = document.getElementById("resultsContainer");
  container.innerHTML = "";

  if (!products.length) {
    container.innerHTML = '<div class="product-card">No products found.</div>';
    return;
  }

  products.slice(0, 100).forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";

    if (product.hiddenDiscovery) {
      if (product.confidence === "HIGH") {
        card.style.border = "2px solid #4caf50";
      } else if (product.confidence === "MEDIUM") {
        card.style.border = "2px solid #ff9800";
      } else {
        card.style.border = "2px solid #f44336";
      }
    }

    card.innerHTML = `
      ${
        product.image
          ? `<img src="${product.image}" class="product-image" alt="${product.title || "Product"}">`
          : ""
      }

      <div class="product-title">
        ${product.title || "Unknown Product"}
      </div>

      ${product.launchDate ? `<div class="product-meta">🚀 Launch: ${product.launchDate}</div>` : ""}

      ${product.hiddenDiscovery ? `<div class="product-meta">Hidden Vehicle Listing</div>` : ""}

      ${!product.hiddenDiscovery ? `
      <div class="product-meta">Price: $${product.price || 0}</div>

      <div class="product-meta" style="display: flex; align-items: center; justify-content: space-between;">
        <span>
          Stock:
          <strong>
            ${
              product.quantity !== null && product.quantity !== undefined
                ? product.quantity
                : product.available
                  ? "In Stock"
                  : "Sold Out"
            }
          </strong>
        </span>

        ${
          product.available === true
            ? `<span class="stock-badge ${
                Number.isFinite(Number(product.quantity)) && Number(product.quantity) > 0
                  ? Number(product.quantity) < 20
                    ? 'stock-low'
                    : Number(product.quantity) < 100
                      ? 'stock-medium'
                      : 'stock-high'
                  : 'stock-high'
              }">
                ${
                  Number.isFinite(Number(product.quantity)) && Number(product.quantity) > 0
                    ? Number(product.quantity) < 20
                      ? '🔥 LOW STOCK'
                      : Number(product.quantity) < 100
                        ? '⚡ MOVING FAST'
                        : '🟢 IN STOCK'
                    : '🟢 IN STOCK'
                }
              </span>`
            : `<span class="stock-badge stock-low">🔴 SOLD OUT</span>`
        }
      </div>

      <!-- Live Inventory Meter -->
      <div class="stock-bar-container">
        <div
          class="stock-bar-fill"
          style="width: ${
            product.quantity !== null && product.quantity !== undefined
              ? Math.min(100, Math.max(0, (product.quantity / 500) * 100))
              : product.available
                ? 100
                : 0
          }%;"
        ></div>
      </div>

      <!-- Live Inventory Meter -->
      <div class="stock-bar-container">
        <div
          class="stock-bar-fill"
          style="width: ${Math.min(100, Math.max(0, ((product.quantity || 0) / 500) * 100))}%;"
        ></div>
      </div>

      <div class="product-meta">${product.analytics?.trendingLevel || "😴 QUIET"}</div>
      <div class="product-meta">Health: ${product.analytics?.healthScore || 0}/100</div>
      ` : ""}
    `;

    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = "display: flex; gap: 6px; margin-top: 8px;";

    if (product.url) {
      const viewBtn = document.createElement("button");
      viewBtn.className = "product-link";
      viewBtn.textContent = "👀 View";
      viewBtn.style.flex = "1";

      viewBtn.addEventListener("click", () => {
        window.open(product.url, "_blank");
      });

      btnContainer.appendChild(viewBtn);
    }

    // Direct Variant Checkout Button with Dynamic Fetch Fallback
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.value = "1";
    qtyInput.min = "1";
    qtyInput.max = "10";
    qtyInput.title = "Select Quantity";
    qtyInput.style.cssText =
      "width: 38px; padding: 5px; background: #222; border: 1px solid #444; color: #fff; border-radius: 4px; text-align: center; font-size: 11px; font-weight: bold;";

    const checkoutBtn = document.createElement("button");
    checkoutBtn.textContent = "⚡ Direct Checkout";
    checkoutBtn.style.cssText =
      "flex: 1; padding: 6px; background: #ff4500; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;";

    checkoutBtn.addEventListener("click", async () => {
      let targetVariant =
        product.variantId ||
        (product.variants && product.variants[0]?.id);

      const qty = parseInt(qtyInput.value, 10) || 1;

      // If variantId missing in cache, fetch it live from Shopify JSON
      if (!targetVariant && product.handle) {
        checkoutBtn.textContent = "⏳ Fetching...";

        try {
          const res = await fetch(
            `https://creations.mattel.com/products/${product.handle}.js`
          );

          const data = await res.json();
          targetVariant = data.variants?.[0]?.id;
        } catch (err) {
          console.error("Failed to fetch variant ID:", err);
        }
      }

      if (targetVariant) {
        window.open(
          `https://creations.mattel.com/cart/${targetVariant}:${qty}`,
          "_blank"
        );
      } else {
        window.open(product.url, "_blank");
      }

      checkoutBtn.textContent = "⚡ Direct Checkout";
    });

    btnContainer.appendChild(qtyInput);
    btnContainer.appendChild(checkoutBtn);

    card.appendChild(btnContainer);
    container.appendChild(card);
  });
}


// ============================================================
// PRODUCT FILTERS
// All normal product views are automatically newest-first
// through renderProducts().
// ============================================================

document.getElementById("showInStock").addEventListener("click", () => {
  currentView = allProducts.filter(
    p => p.available && !p.hiddenDiscovery
  );

  renderProducts(currentView, "🟢 In Stock Products");
});


document.getElementById("showUpcoming").addEventListener("click", async () => {
  const response = await getUpcomingProducts();
  const products = response.products || [];

  document.getElementById("upcomingCount").textContent = products.length;

  currentView = products;

  renderProducts(products, "🚀 Upcoming Products");
});


document.getElementById("showHidden").addEventListener("click", async () => {
  const response = await getHiddenProducts();

  const products = (response.products || []).sort((a, b) => {
    const rank = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1
    };

    return (rank[b.confidence] || 0) - (rank[a.confidence] || 0);
  });

  currentView = products;

  // Keep Hidden's intentional confidence ordering
  renderProducts(products, "👻 Hidden Products", true);
});

document.getElementById("showRLC").addEventListener("click", () => {
  currentView = allProducts
    .filter(
      p =>
        p.available &&
        !p.hiddenDiscovery &&
        (p.title || "").toLowerCase().includes("rlc")
    )
    .sort((a, b) => {
      const aFirstSeen = getProductTimestamp(a);
      const bFirstSeen = getProductTimestamp(b);
      return bFirstSeen - aFirstSeen;
    });

  renderProducts(currentView, "🏁 RLC In Stock", true);
});

document.getElementById("showElite64").addEventListener("click", () => {
  currentView = allProducts
    .filter(
      p =>
        p.available &&
        !p.hiddenDiscovery &&
        (p.title || "").toLowerCase().includes("elite 64")
    )
    .sort((a, b) => {
      const aFirstSeen = getProductTimestamp(a);
      const bFirstSeen = getProductTimestamp(b);
      return bFirstSeen - aFirstSeen;
    });

  renderProducts(currentView, "💎 Elite 64 In Stock", true);
});

document.getElementById("showPremium").addEventListener("click", () => {
  currentView = allProducts
    .filter(
      p =>
        p.available &&
        !p.hiddenDiscovery &&
        (p.title || "").toLowerCase().includes("premium")
    )
    .sort((a, b) => {
      const aFirstSeen = getProductTimestamp(a);
      const bFirstSeen = getProductTimestamp(b);
      return bFirstSeen - aFirstSeen;
    });

  renderProducts(currentView, "🔥 Premium In Stock", true);
});

document.getElementById("showOther").addEventListener("click", () => {
  currentView = allProducts
    .filter(p => {
      if (!p.available || p.hiddenDiscovery) return false;

      const title = (p.title || "").toLowerCase();

      return !title.includes("rlc") &&
             !title.includes("elite 64") &&
             !title.includes("premium");
    })
    .sort((a, b) => {
      const aFirstSeen = getProductTimestamp(a);
      const bFirstSeen = getProductTimestamp(b);
      return bFirstSeen - aFirstSeen;
    });

  renderProducts(currentView, "📦 Other In Stock", true);
});
document.getElementById("showRestocks").addEventListener("click", () => {
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  currentView = allProducts.filter(
    p =>
      p.available === true &&
      !p.hiddenDiscovery &&
      p.stats?.restockTimestamps?.some(time => time >= oneWeekAgo)
  );

  renderProducts(currentView, "⚡ Recent Restocks (Week)");
});


document.getElementById("showSoldOut").addEventListener("click", () => {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

  const soldOutHistory = allProducts
    .map(product => {
      const timestamps = Array.isArray(product.stats?.selloutTimestamps)
        ? product.stats.selloutTimestamps
            .map(Number)
            .filter(time => Number.isFinite(time) && time > 0)
        : [];

      const lastSellout = timestamps.length
        ? Math.max(...timestamps)
        : null;

      return {
        ...product,
        lastSellout
      };
    })
    .filter(product => product.lastSellout !== null)
    .sort((a, b) => b.lastSellout - a.lastSellout);

  const period = prompt(
    "Sold Out History\n\n" +
    "1 = Today\n" +
    "2 = This Week\n" +
    "3 = This Month\n" +
    "4 = All Time\n\n" +
    "Enter 1, 2, 3, or 4:",
    "2"
  );

  let filtered = soldOutHistory;
  let title = "🔴 Sold Out History — All Time";

  if (period === "1") {
    filtered = soldOutHistory.filter(p => p.lastSellout >= oneDayAgo);
    title = "🔴 Sold Out History — Today";
  } else if (period === "2") {
    filtered = soldOutHistory.filter(p => p.lastSellout >= oneWeekAgo);
    title = "🔴 Sold Out History — This Week";
  } else if (period === "3") {
    filtered = soldOutHistory.filter(p => p.lastSellout >= oneMonthAgo);
    title = "🔴 Sold Out History — This Month";
  } else if (period === "4" || period === null || period === "") {
    filtered = soldOutHistory;
    title = "🔴 Sold Out History — All Time";
  }

  currentView = filtered;

  // Keep Sold Out History's intentional most-recent-sellout ordering
  renderProducts(currentView, title, true);
});


function setupSearch() {
  document.getElementById("searchBox").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();

    if (!term) {
      renderProducts(currentView, "Current Results");
      return;
    }

    const results = currentView.filter(product =>
      (product.title || "").toLowerCase().includes(term)
    );

    const title = document.getElementById("resultsTitle").textContent;

    renderProducts(results, title);
  });
}


async function loadDashboard() {
  const response = await getDashboardData();

  if (!response) return;

  allProducts = response.products || [];

  // Pass background-calculated stats directly
  updateCounters(response.stats || {}, allProducts);

  currentView = [...allProducts];

  // Dashboard also uses newest-first ordering
  renderProducts(allProducts.slice(0, 50), "Dashboard Results");
}


document.addEventListener("DOMContentLoaded", async () => {
  const scanBtn = document.getElementById("scanNowBtn");
  const openTabBtn = document.getElementById("openTabBtn");

  // Handler to open Full View in a new tab or window
  if (openTabBtn) {
    openTabBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("popup.html")
      });
    });
  }

  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning...";

    try {
      await scanNow();
      setTimeout(loadDashboard, 2000);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan Now";
    }
  });

  setupSettingsPanel(); // Init UI settings logic
  setupSearch();

  await loadDashboard();
});


// Load saved Webhook URL on startup
// --- DISCORD WEBHOOK & AUTOFILL HANDLERS ---
function initExtraSettings() {

  // Load saved Webhook URL
  chrome.storage.local.get(["discordWebhookUrl"], (result) => {
    const webhookInput = document.getElementById("discordWebhook");

    if (webhookInput && result.discordWebhookUrl) {
      webhookInput.value = result.discordWebhookUrl;
    }
  });


  // Save Webhook URL
  document.getElementById("saveWebhookBtn")?.addEventListener("click", () => {
    const url =
      document.getElementById("discordWebhook")?.value.trim() || "";

    chrome.storage.local.set(
      { discordWebhookUrl: url },
      () => {
        alert("✅ Discord Webhook saved!");
      }
    );
  });


  // Test Webhook
  document.getElementById("testWebhookBtn")?.addEventListener("click", () => {
    const url =
      document.getElementById("discordWebhook")?.value.trim() || "";

    if (!url) {
      alert("Please enter a valid Discord Webhook URL first.");
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: "TEST_DISCORD_WEBHOOK",
        webhookUrl: url
      },
      (response) => {
        if (response?.success) {
          alert("🎉 Test message sent to Discord!");
        } else {
          alert("❌ Failed to send Discord message. Check your URL.");
        }
      }
    );
  });


  // Load saved Auto-Fill Profile
  chrome.storage.local.get(["autofillProfile"], (res) => {
    const p = res.autofillProfile || {};

    if (document.getElementById("afEmail") && p.email) {
      document.getElementById("afEmail").value = p.email;
    }

    if (document.getElementById("afFirstName") && p.firstName) {
      document.getElementById("afFirstName").value = p.firstName;
    }

    if (document.getElementById("afLastName") && p.lastName) {
      document.getElementById("afLastName").value = p.lastName;
    }

    if (document.getElementById("afAddress") && p.address) {
      document.getElementById("afAddress").value = p.address;
    }

    if (document.getElementById("afCity") && p.city) {
      document.getElementById("afCity").value = p.city;
    }

    if (document.getElementById("afZip") && p.zip) {
      document.getElementById("afZip").value = p.zip;
    }

    if (document.getElementById("afPhone") && p.phone) {
      document.getElementById("afPhone").value = p.phone;
    }
  });


  // Save Auto-Fill Profile
  document.getElementById("saveAutofillBtn")?.addEventListener("click", () => {
    const profile = {
      email: document.getElementById("afEmail")?.value.trim() || "",
      firstName: document.getElementById("afFirstName")?.value.trim() || "",
      lastName: document.getElementById("afLastName")?.value.trim() || "",
      address: document.getElementById("afAddress")?.value.trim() || "",
      city: document.getElementById("afCity")?.value.trim() || "",
      zip: document.getElementById("afZip")?.value.trim() || "",
      phone: document.getElementById("afPhone")?.value.trim() || ""
    };

    chrome.storage.local.set(
      { autofillProfile: profile },
      () => {
        alert("⚡ Auto-Fill Profile Saved!");
      }
    );
  });
}


// Run extra settings setup on popup load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initExtraSettings);
} else {
  initExtraSettings();
}