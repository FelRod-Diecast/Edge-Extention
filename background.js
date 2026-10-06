importScripts("config.js");

let itemsState = {};
let lastAlertTime = {};
let hiddenSeen = {};
let stateLoaded = false;
let scanInProgress = false;

const notificationUrls = {};

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const ETA_WINDOW_HOURS = 12;
const MAX_BROWSER_ALERTS_PER_MINUTE = 8;

const browserAlertTimes = [];

const BLOCKED_HANDLES = [
  "red-line-club-exclusive-2025-hot-wheels-super-treasure-hunt-set-jcp51"
];

function defaultStats() {
  return {
    restockEvents: 0,
    selloutEvents: 0,
    restockTimestamps: [],
    selloutTimestamps: [],
    stockHistory: [],
    firstSeen: Date.now(),
    lastSeen: Date.now()
  };
}

function ensureStats(item) {
  if (!item.stats || typeof item.stats !== "object") {
    item.stats = defaultStats();
  }

  item.stats.restockEvents ??= 0;
  item.stats.selloutEvents ??= 0;
  item.stats.restockTimestamps ??= [];
  item.stats.selloutTimestamps ??= [];
  item.stats.stockHistory ??= [];
  item.stats.firstSeen ??= Date.now();
  item.stats.lastSeen ??= Date.now();

  return item;
}

chrome.storage.local.get(
  ["itemsState", "lastAlertTime", "hiddenSeen"],
  result => {
    itemsState = result.itemsState || {};
    lastAlertTime = result.lastAlertTime || {};
    hiddenSeen = result.hiddenSeen || {};

    let migrated = 0;

    for (const key of Object.keys(itemsState)) {
      const item = ensureStats(itemsState[key]);

      if (!/^\d+$/.test(key)) {
        continue;
      }

      if (item?.id && item?.handle) {
        const newKey = `${item.id}_${item.handle}`;

        if (!itemsState[newKey]) {
          itemsState[newKey] = item;
          migrated++;
        }

        delete itemsState[key];
      }
    }

    if (migrated > 0) {
      chrome.storage.local.set({ itemsState });
    }

    stateLoaded = true;

    console.log(
      `[Mattel] Loaded ${Object.keys(itemsState).length} tracked products`
    );
  }
);

function saveState() {
  chrome.storage.local.set({
    itemsState,
    lastAlertTime,
    hiddenSeen
  });
}

function saveUpcoming(products) {
  chrome.storage.local.set({
    upcomingProducts: products
  });
}

function saveHidden(products) {
  chrome.storage.local.set({
    hiddenProducts: products,
    hiddenCount: products.length,
    hiddenUpdated: Date.now()
  });
}

async function playAlertSound() {
  const { soundEnabled } = await chrome.storage.local.get([
    "soundEnabled"
  ]);

  if (soundEnabled === false) {
    return;
  }

  try {
    let hasOffscreen = false;

    try {
      hasOffscreen = await chrome.offscreen.hasDocument();
    } catch (_) {
      hasOffscreen = false;
    }

    if (!hasOffscreen) {
      try {
        await chrome.offscreen.createDocument({
          url: "sound.html",
          reasons: ["AUDIO_PLAYBACK"],
          justification:
            "Play alert sound when a hot drop or hidden item is detected"
        });
      } catch (createError) {
        if (
          !String(createError?.message || createError)
            .toLowerCase()
            .includes("single offscreen document")
        ) {
          throw createError;
        }
      }
    }

    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({
          action: "PLAY_ALERT_SOUND"
        });
      } catch (_) {}
    }, 100);
  } catch (err) {
    console.error("[AUDIO] Error playing sound:", err);
  }
}

function openAutoPopoutWindow(url) {
  if (!url) {
    return;
  }

  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 500,
      height: 750,
      focused: true
    },
    win => {
      console.log(
        "[AUTO-POPOUT] Opened checkout window ID:",
        win?.id
      );
    }
  );
}

async function shouldPopoutItem(title) {
  const {
    popoutMode,
    popoutKeywords
  } = await chrome.storage.local.get([
    "popoutMode",
    "popoutKeywords"
  ]);

  const mode = popoutMode || "RLC_ONLY";
  const titleLower = String(title || "").toLowerCase();

  if (mode === "OFF") {
    return false;
  }

  if (mode === "ALL") {
    return true;
  }

  if (mode === "RLC_ONLY") {
    return (
      titleLower.includes("rlc") ||
      titleLower.includes("red line club") ||
      titleLower.includes("elite 64")
    );
  }

  if (mode === "KEYWORDS" && popoutKeywords) {
    const keywords = popoutKeywords
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);

    return keywords.some(kw => titleLower.includes(kw));
  }

  return false;
}

function browserAlertAllowed() {
  const now = Date.now();

  while (
    browserAlertTimes.length &&
    now - browserAlertTimes[0] >= 60000
  ) {
    browserAlertTimes.shift();
  }

  if (
    browserAlertTimes.length >=
    MAX_BROWSER_ALERTS_PER_MINUTE
  ) {
    return false;
  }

  browserAlertTimes.push(now);

  return true;
}

async function notifyBrowser(
  title,
  message,
  url,
  isHighPriority = false
) {
  if (!browserAlertAllowed()) {
    console.warn(
      "[ALERT LIMIT] Browser notification suppressed:",
      title,
      message
    );

    return false;
  }

  const id =
    `mattel_${Date.now()}_` +
    Math.random().toString(36).slice(2, 9);

  const isDirectCart =
    Boolean(url && url.includes("/cart/"));

  const directCartUrl =
    isDirectCart ? url : null;

  const productUrl =
    isDirectCart
      ? url.replace(/\/cart\/.*/, "")
      : url;

  if (url) {
    notificationUrls[id] = {
      productUrl,
      directCartUrl: url
    };
  }

  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon.png",
    title: String(title || "Mattel Tracker"),
    message: String(message || ""),
    buttons: [
      {
        title: "⚡ Quick Checkout"
      },
      {
        title: "👀 View Product"
      }
    ],
    priority: 2
  });

  playAlertSound();

  if (isHighPriority && url) {
    const popoutAllowed =
      await shouldPopoutItem(message || title);

    if (popoutAllowed) {
      openAutoPopoutWindow(url);
    }
  }

  return true;
}

function canAlertItem(key, alertType) {
  const lockKey = `${alertType}_${key}`;
  const now = Date.now();

  const permanent =
    alertType === "HIDDEN_NEW_DISCOVERY" ||
    alertType === "UPCOMING_LAUNCH";

  if (
    permanent &&
    hiddenSeen[lockKey]?.alerted
  ) {
    return false;
  }

  if (
    lastAlertTime[lockKey] &&
    now - lastAlertTime[lockKey] <
      ALERT_COOLDOWN_MS
  ) {
    return false;
  }

  lastAlertTime[lockKey] = now;

  if (permanent) {
    hiddenSeen[lockKey] = {
      alerted: true,
      timestamp: now
    };
  }

  saveState();

  return true;
}

function isHotWheels(p) {
  const title =
    String(p.title || "").toLowerCase();

  const excluded = [
    "shirt",
    "t-shirt",
    "tee",
    "hoodie",
    "sweatshirt",
    "sweater",
    "sweaters",
    "ugly sweater",
    "ugly sweaters",
    "jacket",
    "zip jacket",
    "front zip jacket",
    "full zip",
    "windbreaker",
    "pullover",
    "fleece",
    "crewneck",
    "zip-up",
    "jersey",
    "jerseys",
    "mug",
    "tumbler",
    "tumblers",
    "cup",
    "drinkware",
    "blanket",
    "hat",
    "beanie",
    "sticker",
    "pin",
    "keychain",
    "poster",
    "art print",
    "print",
    "lithograph",
    "tote",
    "backpack",
    "bag"
  ];

  if (
    excluded.some(word =>
      title.includes(word)
    )
  ) {
    return false;
  }

  return (
    title.includes("hot wheels") ||
    title.includes("rlc") ||
    title.includes("red line club") ||
    title.includes("elite 64")
  );
}

async function sendWebhookEmbed(embed) {
  try {
    const {
      discordWebhookUrl
    } = await chrome.storage.local.get([
      "discordWebhookUrl"
    ]);

    if (!discordWebhookUrl) {
      return;
    }

    const response = await fetch(
      discordWebhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: "Mattel Drop Tracker",
          avatar_url:
            "https://creations.mattel.com/cdn/shop/files/Hot_Wheels_Logo.png",
          embeds: [embed]
        })
      }
    );

    if (!response.ok) {
      console.warn(
        "[DISCORD] Webhook returned HTTP",
        response.status
      );
    }
  } catch (err) {
    console.error(
      "[DISCORD WEBHOOK ERROR]",
      err
    );
  }
}

async function checkLiveInventory(handle) {
  if (!handle) {
    return null;
  }

  try {
    const res = await fetch(
      `https://creations.mattel.com/products/${handle}.js`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    if (!res.ok) {
      console.warn(
        `[STOCK TRACKER] Live inventory request failed for ${handle}: HTTP ${res.status}`
      );

      return null;
    }

    const data = await res.json();

    if (
      !data ||
      !Array.isArray(data.variants)
    ) {
      console.warn(
        `[STOCK TRACKER] Invalid inventory response for ${handle}`
      );

      return null;
    }

    let totalStock = 0;
    let hasInventoryData = false;
    let firstAvailableVariantId = null;
    let liveAvailable = false;

    for (const variant of data.variants) {
      if (variant.available === true) {
        liveAvailable = true;

        if (
          !firstAvailableVariantId &&
          variant.id
        ) {
          firstAvailableVariantId =
            String(variant.id);
        }
      }

      const rawQuantity =
        variant.inventory_quantity;

      if (
        rawQuantity !== undefined &&
        rawQuantity !== null &&
        Number.isFinite(
          Number(rawQuantity)
        )
      ) {
        hasInventoryData = true;

        const quantity =
          Number(rawQuantity);

        if (quantity > 0) {
          totalStock += quantity;

          if (
            !firstAvailableVariantId &&
            variant.id
          ) {
            firstAvailableVariantId =
              String(variant.id);
          }
        }
      }
    }

    return {
      ok: true,
      available: liveAvailable,
      quantity: hasInventoryData
        ? totalStock
        : null,
      variantId:
        firstAvailableVariantId
    };
  } catch (err) {
    console.error(
      `[STOCK TRACKER] Live inventory fetch failed for ${handle}:`,
      err
    );

    return null;
  }
}

chrome.notifications.onClicked.addListener(
  id => {
    const target =
      notificationUrls[id];

    if (!target) {
      return;
    }

    const targetUrl =
      target.directCartUrl ||
      target.productUrl;

    if (targetUrl) {
      chrome.tabs.create({
        url: targetUrl
      });
    }
  }
);

chrome.notifications.onButtonClicked.addListener(
  (id, buttonIndex) => {
    const target =
      notificationUrls[id];

    if (!target) {
      return;
    }

    if (buttonIndex === 0) {
      const checkoutUrl =
        target.directCartUrl ||
        target.productUrl;

      openAutoPopoutWindow(
        checkoutUrl
      );
    } else if (buttonIndex === 1) {
      const viewUrl =
        target.productUrl ||
        target.directCartUrl;

      chrome.tabs.create({
        url: viewUrl
      });
    }
  }
);

function addStockHistory(
  entry,
  available,
  quantity
) {
  ensureStats(entry);

  entry.stats.stockHistory.push({
    time: Date.now(),
    available,
    quantity
  });

  if (
    entry.stats.stockHistory.length >
    500
  ) {
    entry.stats.stockHistory.shift();
  }
}

function computeHealthScore(entry) {
  ensureStats(entry);

  let score = 50;

  score +=
    (entry.stats.restockEvents || 0) *
    5;

  score +=
    (entry.stats.selloutEvents || 0) *
    3;

  if (entry.available) {
    score += 15;
  }

  score += Math.min(
    20,
    Math.floor(
      (entry.quantity || 0) / 10
    )
  );

  return Math.max(
    0,
    Math.min(100, score)
  );
}

function computeVelocity(entry) {
  ensureStats(entry);

  const history =
    entry.stats.stockHistory || [];

  if (history.length < 2) {
    return 0;
  }

  const first =
    history[
      Math.max(
        0,
        history.length - 10
      )
    ];

  const last =
    history[
      history.length - 1
    ];

  const hours =
    (last.time - first.time) /
    3600000;

  if (hours <= 0) {
    return 0;
  }

  return (
    (Number(first.quantity) -
      Number(last.quantity)) /
    hours
  );
}

function predictSellout(entry) {
  const velocity =
    computeVelocity(entry);

  if (
    velocity <= 0 ||
    entry.quantity <= 0
  ) {
    return null;
  }

  return Number(
    (
      entry.quantity / velocity
    ).toFixed(2)
  );
}

function computeRestockProbability(
  entry
) {
  ensureStats(entry);

  const total =
    entry.stats.restockEvents +
    entry.stats.selloutEvents;

  return total
    ? entry.stats.restockEvents /
        total
    : 0;
}

function computeRestockETA(entry) {
  ensureStats(entry);

  const timestamps =
    entry.stats.restockTimestamps;

  if (timestamps.length < 2) {
    return null;
  }

  const avg =
    timestamps
      .slice(1)
      .map(
        (v, i) =>
          v - timestamps[i]
      )
      .reduce(
        (a, b) => a + b,
        0
      ) /
    (timestamps.length - 1);

  const eta =
    timestamps[
      timestamps.length - 1
    ] + avg;

  return {
    etaTimestamp: eta,
    etaText:
      new Date(
        eta
      ).toLocaleString("en-US"),
    windowHours:
      ETA_WINDOW_HOURS
  };
}

function generateDashboardStats() {
  const products =
    Object.values(itemsState);

  const now = Date.now();

  const oneWeekAgo =
    now -
    7 *
      24 *
      60 *
      60 *
      1000;

  const oneDayAgo =
    now -
    24 *
      60 *
      60 *
      1000;

  const rlcCount =
    products.filter(p => {
      const title =
        String(
          p.title || ""
        ).toLowerCase();

      const tags =
        (p.tags || []).map(
          t =>
            String(t)
              .toLowerCase()
        );

      return (
        title.includes("rlc") ||
        title.includes(
          "red line club"
        ) ||
        tags.includes("rlc")
      );
    }).length;

  const elite64Count =
    products.filter(p => {
      const title =
        String(
          p.title || ""
        ).toLowerCase();

      const tags =
        (p.tags || []).map(
          t =>
            String(t)
              .toLowerCase()
        );

      return (
        title.includes("elite 64") ||
        title.includes("elite64") ||
        tags.includes("elite 64")
      );
    }).length;

  const premiumCount =
    products.filter(p => {
      const title =
        String(
          p.title || ""
        ).toLowerCase();

      const tags =
        (p.tags || []).map(
          t =>
            String(t)
              .toLowerCase()
        );

      return (
        title.includes(
          "car culture"
        ) ||
        title.includes(
          "boulevard"
        ) ||
        title.includes(
          "team transport"
        ) ||
        title.includes(
          "premium"
        ) ||
        tags.includes(
          "premium"
        )
      );
    }).length;

  const weeklyRestockCount =
    products.filter(p =>
      (
        p.stats
          ?.restockTimestamps ||
        []
      ).some(
        ts =>
          ts >= oneWeekAgo
      )
    ).length;

  const soldOutCount =
    products.filter(
      p => !p.available
    ).length;

  const inStockCount =
    products.filter(
      p => p.available
    ).length;

  return {
    tracked:
      products.length,

    activeRestocks:
      inStockCount,

    inStock:
      inStockCount,

    lowStock:
      products.filter(
        x =>
          x.quantity > 0 &&
          x.quantity < 25
      ).length,

    launchesSoon:
      products.filter(
        x => x.upcoming
      ).length,

    hiddenProducts: 0,

    newProducts:
      products.filter(
        p =>
          p.addedDate &&
          new Date(
            p.addedDate
          ).getTime() >=
            oneDayAgo
      ).length,

    rlc:
      rlcCount,

    elite64:
      elite64Count,

    premium:
      premiumCount,

    restocks:
      weeklyRestockCount,

    soldOut:
      soldOutCount
  };
}

function generateProductSummary(
  entry
) {
  const healthScore =
    computeHealthScore(entry);

  return {
    healthScore,

    velocity:
      computeVelocity(
        entry
      ).toFixed(1),

    selloutEtaHours:
      predictSellout(entry),

    restockProbability:
      Math.round(
        computeRestockProbability(
          entry
        ) * 100
      ),

    restockEta:
      computeRestockETA(entry),

    trendingLevel:
      healthScore >= 90
        ? "🔥 HOT"
        : healthScore >= 75
        ? "⚡ TRENDING"
        : healthScore >= 60
        ? "📈 ACTIVE"
        : "😴 QUIET"
  };
}

async function getLaunchInfo(
  handle
) {
  try {
    const res =
      await fetch(
        `https://creations.mattel.com/products/${handle}`
      );

    const html =
      await res.text();

    const match =
      html.match(
        /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i
      );

    if (!match) {
      return {
        upcoming: false,
        launchDate: null
      };
    }

    return {
      upcoming: true,
      launchDate: match[1]
    };
  } catch (err) {
    console.error(
      "[UPCOMING] Launch info error:",
      err
    );

    return {
      upcoming: false,
      launchDate: null
    };
  }
}

async function scanUpcomingProducts() {
  console.log(
    "[UPCOMING] Scan starting..."
  );

  const storedResult =
    await chrome.storage.local.get([
      "upcomingProducts"
    ]);

  const storedUpcoming =
    Array.isArray(
      storedResult.upcomingProducts
    )
      ? storedResult.upcomingProducts
      : [];

  const candidatesMap =
    new Map();

  for (const product of Object.values(itemsState)) {
    const title =
      String(
        product.title || ""
      ).toLowerCase();

    if (
      title.includes("rlc") ||
      title.includes("elite 64")
    ) {
      candidatesMap.set(
        product.handle,
        product
      );
    }
  }

  /*
   * Keep stored items available for checking, but do NOT
   * automatically treat them as Upcoming.
   *
   * The stored cache may contain historical products from
   * the previous bad scan. The release/alert checks below
   * decide whether each stored item is actually allowed back.
   */
  for (const stored of storedUpcoming) {
    if (
      stored?.handle &&
      !candidatesMap.has(
        stored.handle
      )
    ) {
      candidatesMap.set(
        stored.handle,
        stored
      );
    }
  }

  const upcomingProducts = [];
  const now = Date.now();

  for (const product of candidatesMap.values()) {
    try {
      const launchInfo =
        await getLaunchInfo(
          product.handle
        );

      const stored =
        storedUpcoming.find(
          item =>
            item?.handle ===
            product.handle
        );

      const launchDateText =
        launchInfo.upcoming &&
        launchInfo.launchDate
          ? launchInfo.launchDate
          : stored?.launchDate ||
            product.launchDate ||
            null;

      if (!launchDateText) {
        continue;
      }

      const launchDate =
        new Date(
          launchDateText.replace(
            "PT",
            ""
          )
        );

      const hasValidLaunchDate =
        !Number.isNaN(
          launchDate.getTime()
        );

      if (!hasValidLaunchDate) {
        continue;
      }

      const launchTime =
        launchDate.getTime();

      /*
       * Do not keep products that are currently available.
       * Upcoming is intended for not-yet-available / release-window
       * products, not products already showing as available.
       */
      const liveInventory =
        await checkLiveInventory(
          product.handle
        );

      if (
        liveInventory?.ok === true &&
        liveInventory.available === true
      ) {
        continue;
      }

      const upcomingKey =
        `upcoming_${product.handle}`;

      /*
       * A past-launch product is allowed to remain in Upcoming
       * ONLY if the extension previously recorded an actual
       * Upcoming Launch alert for it BEFORE the launch time.
       *
       * This is the important protection against the 66 historical
       * products that were accidentally resurrected.
       */
      const currentAlert =
        hiddenSeen[
          `UPCOMING_LAUNCH_${upcomingKey}`
        ];

      const legacyAlert =
        hiddenSeen[
          upcomingKey
        ];

      const alertRecord =
        currentAlert?.alerted
          ? currentAlert
          : legacyAlert?.alerted
            ? legacyAlert
            : null;

      const alertTimestamp =
        Number(
          alertRecord?.timestamp
        );

      const wasKnownBeforeRelease =
        Boolean(
          alertRecord &&
          Number.isFinite(
            alertTimestamp
          ) &&
          alertTimestamp <= launchTime
        );

      /*
       * FUTURE:
       * Always show legitimate future launches.
       *
       * PAST:
       * Only retain a product if we actually knew about it
       * before its release.
       */
      if (
        launchTime <= now &&
        !wasKnownBeforeRelease
      ) {
        continue;
      }

      const daysUntilLaunch =
        Math.ceil(
          (launchTime - now) /
          (
            1000 *
            60 *
            60 *
            24
          )
        );

      let upcomingCategory =
        "Future";

      if (
        launchTime <= now
      ) {
        upcomingCategory =
          "LIVE WINDOW";
      } else if (
        daysUntilLaunch <= 30
      ) {
        upcomingCategory =
          "30 Days";
      } else if (
        daysUntilLaunch <= 60
      ) {
        upcomingCategory =
          "60 Days";
      } else if (
        daysUntilLaunch <= 90
      ) {
        upcomingCategory =
          "90 Days";
      }

      const savedProduct = {
        ...stored,
        ...product,
        launchDate:
          launchDateText,
        daysUntilLaunch:
          launchTime <= now
            ? 0
            : daysUntilLaunch,
        upcomingCategory,
        upcoming: true,
        upcomingLastChecked:
          now
      };

      upcomingProducts.push(
        savedProduct
      );

      /*
       * Discord/browser alert ONLY for future launches.
       *
       * This preserves the existing one-time notification behavior
       * and prevents released products from generating alerts.
       */
      if (
        launchInfo.upcoming &&
        launchTime > now &&
        !alertRecord?.alerted &&
        canAlertItem(
          upcomingKey,
          "UPCOMING_LAUNCH"
        )
      ) {
        notifyBrowser(
          "🚀 UPCOMING LAUNCH",
          product.title,
          product.url,
          false
        );

        sendWebhookEmbed({
          title:
            "🚀 UPCOMING LAUNCH",

          description:
            product.title,

          url:
            product.url,

          color:
            16753920,

          thumbnail: {
            url:
              product.image
          },

          fields: [
            {
              name:
                "Launch",
              value:
                launchDateText
            }
          ],

          timestamp:
            new Date().toISOString()
        });

        hiddenSeen[
          `UPCOMING_LAUNCH_${upcomingKey}`
        ] = {
          alerted:
            true,
          launchDate:
            launchDateText,
          timestamp:
            now
        };

        saveState();
      }
    } catch (err) {
      console.error(
        "[UPCOMING]",
        product?.handle,
        err
      );
    }
  }

  /*
   * This also cleans the contaminated Upcoming cache.
   * Historical products that fail the rules above are removed
   * from the saved Upcoming list on this scan.
   */
  saveUpcoming(
    upcomingProducts
  );

  console.log(
    `[UPCOMING] Found ${upcomingProducts.length} upcoming products`
  );
}
async function getProductPageInfo(
  handle
) {
  try {
    const res =
      await fetch(
        `https://creations.mattel.com/products/${handle}`
      );

    const html =
      await res.text();

    const titleMatch =
      html.match(
        /<title>(.*?)<\/title>/i
      );

    const ogTitleMatch =
      html.match(
        /property="og:title"\s+content="([^"]+)"/i
      );

    const lower =
      html.toLowerCase();

    return {
      html,

      exists:
        !html.includes(
          "Page not found"
        ),

      vehiclePage:
        lower.includes(
          "hot wheels"
        ) ||
        lower.includes(
          "matchbox"
        ),

      hasLaunchText:
        html.includes(
          "Launches"
        ),

      title:
        ogTitleMatch?.[1] ||
        titleMatch?.[1]
          ?.replace(
            /\s*\|\s*Mattel.*$/i,
            ""
          )
          .trim() ||
        handle
    };
  } catch (_) {
    return {
      html: "",
      exists: false
    };
  }
}

async function scanHiddenProducts() {
  console.log(
    "[HIDDEN] Strict deduplicated scan starting..."
  );

  try {
    const hiddenProducts = [];
    const seenHandles =
      new Set();

    const rawMatches = [];

    const sources = [
      "https://creations.mattel.com/pages/launch-calendar",
      "https://creations.mattel.com/collections/hot-wheels",
      "https://creations.mattel.com/collections/red-line-club",
      "https://creations.mattel.com/collections/elite-64",
      "https://creations.mattel.com/collections/matchbox",
      "https://creations.mattel.com/collections/new-arrivals"
    ];

    for (const source of sources) {
      try {
        const res =
          await fetch(source);

        const html =
          await res.text();

        const found =
          html.matchAll(
            /\/products\/([a-z0-9\-]+)/gi
          );

        for (const m of found) {
          rawMatches.push(m[1]);
        }
      } catch (err) {
        console.error(
          "[HIDDEN SOURCE]",
          source,
          err
        );
      }
    }

    try {
      for (
        let page = 1;
        page <= 3;
        page++
      ) {
        const productRes =
          await fetch(
            `https://creations.mattel.com/products.json?page=${page}`
          );

        if (!productRes.ok) {
          break;
        }

        const productData =
          await productRes.json();

        if (
          !productData.products?.length
        ) {
          break;
        }

        for (
          const product of
          productData.products
        ) {
          if (
            product?.handle
          ) {
            rawMatches.push(
              product.handle
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "[HIDDEN JSON]",
        err
      );
    }

    const blockedWords = [
      "jacket",
      "varsity",
      "shirt",
      "t-shirt",
      "tee",
      "unisex",
      "raglan",
      "hoodie",
      "sweatshirt",
      "sweater",
      "crewneck",
      "pullover",
      "fleece",
      "windbreaker",
      "jersey",
      "hat",
      "beanie",
      "pin",
      "sticker",
      "poster",
      "keychain",
      "blanket",
      "bag",
      "pants",
      "glass",
      "luggage",
      "tag",
      "formula-1-team",
      "backpack",
      "mug",
      "cup",
      "tumbler",
      "barbie"
    
    ];

    const vehicleKeywords = [
      "hot-wheels",
      "blazer",
      "silverado",
      "matchbox",
      "rlc",
      "red-line",
      "elite-64",
      "boulevard",
      "team-transport",
      "car-culture",
      "skyline",
      "mustang",
      "porsche",
      "ferrari",
      "nissan",
      "chevrolet",
      "chevy",
      "dodge",
      "ford",
      "toyota",
      "datsun"
    ];

    const legacyYearPattern =
      /(?:2018|2019|2020|2021|2022|2023|2024)/i;

    for (
      const rawHandle of rawMatches
    ) {
      const handle =
        rawHandle?.toLowerCase();

      if (
        !handle ||
        seenHandles.has(handle)
      ) {
        continue;
      }

      seenHandles.add(handle);

      if (
        blockedWords.some(
          w =>
            handle.includes(w)
        )
      ) {
        continue;
      }

      if (
        legacyYearPattern.test(
          handle
        )
      ) {
        continue;
      }

      if (
        !vehicleKeywords.some(
          kw =>
            handle.includes(kw)
        )
      ) {
        continue;
      }

      if (
        Object.values(
          itemsState
        ).some(
          p =>
            p.handle === handle
        )
      ) {
        continue;
      }

      if (
        !await verifyProductUrlLive(
          handle
        )
      ) {
        continue;
      }

      const pageInfo =
        await getProductPageInfo(
          handle
        );

      if (!pageInfo.exists) {
        continue;
      }

      const htmlLower =
        pageInfo.html.toLowerCase();

      if (
        htmlLower.includes(
          "sold out"
        ) ||
        htmlLower.includes(
          "sold-out"
        )
      ) {
        continue;
      }

      const launchMatch =
        pageInfo.html.match(
          /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i
        );

      const launchDate =
        launchMatch?.[1] ||
        null;

      const etaMatch =
        pageInfo.html.match(
          /(?:ships|expected to ship|shipping by)\s+([A-Za-z0-9\s,]+)/i
        );

      const shippingEta =
        etaMatch
          ? etaMatch[1].trim()
          : null;

      const hasAddToCart =
        htmlLower.includes(
          "add-to-cart"
        ) ||
        htmlLower.includes(
          "add to cart"
        );

      if (
        !launchDate &&
        !shippingEta &&
        !pageInfo.hasLaunchText &&
        !hasAddToCart
      ) {
        continue;
      }

      const variantMatch =
        pageInfo.html.match(
          /"variantId":\s*(\d+)/i
        ) ||
        pageInfo.html.match(
          /variant_id=(\d+)/i
        );

      const extractedVariantId =
        variantMatch
          ? variantMatch[1]
          : null;

      const directCheckoutUrl =
        extractedVariantId
          ? `https://creations.mattel.com/cart/${extractedVariantId}:1`
          : `https://creations.mattel.com/products/${handle}`;

      const product = {
        handle,

        title:
          pageInfo.title,

        url:
          `https://creations.mattel.com/products/${handle}`,

        directCartUrl:
          directCheckoutUrl,

        hiddenDiscovery:
          true,

        vehiclePage:
          pageInfo.vehiclePage,

        launchDate,

        shippingEta,

        firstSeen:
          new Date().toISOString()
      };

      hiddenProducts.push(
        product
      );

      if (
        canAlertItem(
          handle,
          "HIDDEN_NEW_DISCOVERY"
        )
      ) {
        notifyBrowser(
          "👻 NEW HIDDEN DROP FOUND",
          pageInfo.title,
          directCheckoutUrl,
          true
        );

        sendWebhookEmbed({
          title:
            "👻 NEW HIDDEN DROP FOUND",

          description:
            `**[${pageInfo.title}](${product.url})**\n\n⚡ **[DIRECT CHECKOUT LINK](${directCheckoutUrl})**`,

          url:
            product.url,

          color:
            8711167,

          fields: [
            {
              name:
                "Launch Date",
              value:
                launchDate ||
                "Upcoming",
              inline: true
            },
            {
              name:
                "Shipping ETA",
              value:
                shippingEta ||
                "Standard",
              inline: true
            },
            {
              name:
                "🛒 Quick Checkout",
              value:
                `[Instant Add to Cart](${directCheckoutUrl})`,
              inline: true
            }
          ],

          timestamp:
            new Date().toISOString()
        });
      }
    }

    saveHidden(
      hiddenProducts
    );

    console.log(
      `[HIDDEN] Found ${hiddenProducts.length} active new hidden products`
    );
  } catch (err) {
    console.error(
      "[HIDDEN]",
      err
    );
  }
}

async function fetchMattelProducts() {
  const products = [];
  let page = 1;

  while (true) {
    const res =
      await fetch(
        `https://creations.mattel.com/products.json?page=${page}`
      );

    if (!res.ok) {
      break;
    }

    const data =
      await res.json();

    if (
      !data.products?.length
    ) {
      break;
    }

    for (
      const p of data.products
    ) {
      if (
        BLOCKED_HANDLES.includes(
          p.handle
        )
      ) {
        continue;
      }

      if (!isHotWheels(p)) {
        continue;
      }

      const variants =
        Array.isArray(
          p.variants
        )
          ? p.variants
          : [];

      const firstVariant =
        variants[0] || {};

      const availableVariant =
        variants.find(
          v =>
            v.available === true
        ) ||
        firstVariant;

      const feedAvailable =
        variants.some(
          v =>
            v.available === true
        );

      const totalQty =
        variants.reduce(
          (sum, v) => {
            const qty =
              Number(
                v.inventory_quantity
              );

            return Number.isFinite(
              qty
            ) && qty > 0
              ? sum + qty
              : sum;
          },
          0
        );

      const variantId =
        availableVariant?.id
          ? String(
              availableVariant.id
            )
          : null;

      const priceNumber =
        parseFloat(
          availableVariant.price ||
            firstVariant.price ||
            0
        );

      const price =
        Number.isFinite(
          priceNumber
        )
          ? priceNumber
          : 0;

      products.push({
        id:
          p.id,

        variantId,

        handle:
          p.handle,

        title:
          p.title,

        price,

        available:
          feedAvailable,

        upcoming:
          false,

        hiddenDiscovery:
          false,

        quantity:
          totalQty,

        url:
          `https://creations.mattel.com/products/${p.handle}`,

        directCartUrl:
          variantId
            ? `https://creations.mattel.com/cart/${variantId}:1`
            : `https://creations.mattel.com/products/${p.handle}`,

        image:
          p.images?.[0]?.src ||
          p.featured_image ||
          "",

        tags:
          p.tags || [],

        launchDate:
          null
      });
    }

    page++;
  }

  return products;
}

async function verifyProductUrlLive(
  handle
) {
  try {
    const targetUrl =
      `https://creations.mattel.com/products/${handle}`;

    const res =
      await fetch(
        targetUrl,
        {
          method: "GET",
          redirect: "follow",
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }
      ).catch(
        () => null
      );

    if (!res || !res.ok) {
      return false;
    }

    const finalUrl =
      String(
        res.url || ""
      ).toLowerCase();

    if (
      !finalUrl.includes(
        `/products/${handle.toLowerCase()}`
      )
    ) {
      return false;
    }

    const html =
      await res.text().catch(
        () => ""
      );

    if (!html) {
      return false;
    }

    const lower =
      html.toLowerCase();

    if (
      html.includes(
        "Page not found"
      ) ||
      html.includes(
        "404 Not Found"
      )
    ) {
      return false;
    }

    if (
      !lower.includes(
        "product-form"
      ) &&
      !lower.includes(
        "add-to-cart"
      ) &&
      !lower.includes(
        "sold-out"
      ) &&
      !lower.includes(
        "price"
      )
    ) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

async function scanMattel() {
  if (!stateLoaded || scanInProgress) return;

  scanInProgress = true;

  try {
    console.log("[SCAN] Starting Mattel scan...");

    const products = await fetchMattelProducts();

    console.log(
      "[STOCK DEBUG] Feed available:",
      products.filter(p => p.available === true).length,
      "/",
      products.length
    );

    console.log(
      "[STOCK DEBUG] Feed quantity > 0:",
      products.filter(p => Number(p.quantity) > 0).length,
      "/",
      products.length
    );

    console.log(
      "[STOCK DEBUG] Previously available:",
      products.filter(
        p => itemsState[`${p.id}_${p.handle}`]?.available === true
      ).length,
      "/",
      products.length
    );

    /*
     * IMPORTANT:
     * The previous scanner had a bad state where products were being
     * stored as SOLD OUT even though the Mattel feed currently reports
     * them as available.
     *
     * We establish a one-time baseline so those existing products do
     * NOT get falsely announced as RESTOCK DETECTED.
     */
    const storageState = await chrome.storage.local.get([
      "mattelBaselineEstablished"
    ]);

    const baselineEstablished =
      storageState.mattelBaselineEstablished === true;

    let baselineChanges = 0;
    let realAlerts = 0;

    for (const p of products) {
      const key = `${p.id}_${p.handle}`;
      let prev = itemsState[key];

      let effectiveAvailable = p.available === true;
      let effectiveQuantity = Number.isFinite(Number(p.quantity))
        ? Number(p.quantity)
        : 0;
      let effectiveVariantId = p.variantId;

      /*
       * Only perform the expensive live inventory request when the
       * Mattel product feed says the item is available or our saved
       * state says it was previously available.
       *
       * This avoids hundreds of unnecessary .js requests every scan.
       */
      const shouldCheckLiveInventory =
        p.available === true ||
        prev?.available === true;

      if (shouldCheckLiveInventory) {
        const liveInventory = await checkLiveInventory(p.handle);

        if (liveInventory?.ok === true) {
          effectiveAvailable = liveInventory.available === true;

          if (
            liveInventory.quantity !== null &&
            Number.isFinite(Number(liveInventory.quantity))
          ) {
            effectiveQuantity = Number(liveInventory.quantity);
          }

          if (liveInventory.variantId) {
            effectiveVariantId = liveInventory.variantId;
          }

          console.log(
            `[STOCK TRACKER] ${p.handle}: ${
              effectiveAvailable ? "IN STOCK" : "SOLD OUT"
            } (qty: ${effectiveQuantity})`
          );
        } else {
          console.warn(
            `[STOCK TRACKER] Live check unavailable for ${p.handle}; using feed state instead.`
          );
        }
      }

      /*
       * First time we've ever seen this product.
       */
      if (!prev) {
        itemsState[key] = {
          ...p,
          available: effectiveAvailable,
          hiddenDiscovery: p.hiddenDiscovery,
          addedDate: new Date().toISOString(),
          stats: {
            restockEvents: 0,
            selloutEvents: 0,
            restockTimestamps: [],
            selloutTimestamps: [],
            stockHistory: [],
            firstSeen: Date.now(),
            lastSeen: Date.now()
          },
          priceHistory: []
        };

        prev = itemsState[key];

        /*
         * New products are only announced if they are genuinely
         * new to our tracker AND this is not the initial baseline.
         */
        if (baselineEstablished && effectiveAvailable) {
          notifyBrowser(
            "🆕 NEW HOT WHEELS PRODUCT",
            p.title,
            p.url,
            false
          );

          sendWebhookEmbed({
            title: "🆕 NEW HOT WHEELS PRODUCT",
            description: `**[${p.title}](${p.url})**`,
            url: p.url,
            color: 5763719,
            thumbnail: p.image
              ? { url: p.image }
              : undefined,
            fields: [
              {
                name: "Price",
                value: `$${Number(p.price || 0).toFixed(2)}`,
                inline: true
              },
              {
                name: "Stock",
                value: "🟢 IN STOCK",
                inline: true
              }
            ],
            timestamp: new Date().toISOString()
          });

          realAlerts++;
        }
      }

      /*
       * Make sure old entries have stats.
       */
      if (!prev.stats) {
        prev.stats = {
          restockEvents: 0,
          selloutEvents: 0,
          restockTimestamps: [],
          selloutTimestamps: [],
          stockHistory: [],
          firstSeen: Date.now(),
          lastSeen: Date.now()
        };
      }

      prev.stats.restockEvents ??= 0;
      prev.stats.selloutEvents ??= 0;
      prev.stats.restockTimestamps ??= [];
      prev.stats.selloutTimestamps ??= [];
      prev.stats.stockHistory ??= [];
      prev.stats.firstSeen ??= Date.now();
      prev.stats.lastSeen ??= Date.now();

      prev.stats.lastSeen = Date.now();

      addStockHistory(
        prev,
        effectiveAvailable,
        effectiveQuantity
      );

      const previousAvailable = prev.available === true;

      /*
       * STOCK TRANSITION
       *
       * During the first scan after this repair, do NOT treat all
       * existing available products as restocks.
       */
      if (previousAvailable !== effectiveAvailable) {
        /*
         * SOLD OUT -> IN STOCK
         */
        if (!previousAvailable && effectiveAvailable) {
          if (!baselineEstablished) {
            baselineChanges++;

            console.log(
              `[BASELINE] Suppressed false restock: ${p.handle}`
            );
          } else if (
            canAlertItem(
              p.handle,
              "RESTOCK"
            )
          ) {
            prev.stats.restockEvents++;
            prev.stats.restockTimestamps.push(Date.now());

            notifyBrowser(
              "🔥 RESTOCK DETECTED",
              p.title,
              p.url,
              true
            );

            sendWebhookEmbed({
              title: "🔥 RESTOCK DETECTED",
              description: `**[${p.title}](${p.url})**`,
              url: p.url,
              color: 16711680,
              thumbnail: p.image
                ? { url: p.image }
                : undefined,
              fields: [
                {
                  name: "Status",
                  value: "🟢 IN STOCK",
                  inline: true
                },
                {
                  name: "Quantity",
                  value: String(effectiveQuantity),
                  inline: true
                },
                {
                  name: "Price",
                  value: `$${Number(p.price || 0).toFixed(2)}`,
                  inline: true
                }
              ],
              timestamp: new Date().toISOString()
            });

            realAlerts++;
          }
        }

               /*
         * IN STOCK -> SOLD OUT
         *
         * Record the sellout event independently from the
         * notification cooldown. History must never depend
         * on whether an alert is allowed to fire.
         */
        if (previousAvailable && !effectiveAvailable) {
          prev.stats.selloutEvents++;
          prev.stats.selloutTimestamps.push(Date.now());

          if (
            canAlertItem(
              p.handle,
              "SELLOUT"
            )
          ) {
            notifyBrowser(
              "🔴 SOLD OUT",
              p.title,
              p.url,
              false
            );

            sendWebhookEmbed({
              title: "🔴 SOLD OUT",
              description: `**[${p.title}](${p.url})**`,
              url: p.url,
              color: 10038562,
              thumbnail: p.image
                ? { url: p.image }
                : undefined,
              fields: [
                {
                  name: "Status",
                  value: "🔴 SOLD OUT",
                  inline: true
                },
                {
                  name: "Last Quantity",
                  value: String(effectiveQuantity),
                  inline: true
                }
              ],
              timestamp: new Date().toISOString()
            });

            realAlerts++;
          }
        }
      }

      /*
       * PRICE CHANGE
       *
       * Do not treat the initial product creation as a price change.
       */
      const oldPrice = Number(prev.price);
      const newPrice = Number(p.price);

      if (
        Number.isFinite(oldPrice) &&
        Number.isFinite(newPrice) &&
        oldPrice !== newPrice &&
        baselineEstablished
      ) {
        if (
          canAlertItem(
            p.handle,
            "PRICE_CHANGE"
          )
        ) {
          if (!prev.priceHistory) {
            prev.priceHistory = [];
          }

          prev.priceHistory.push({
            oldPrice,
            newPrice,
            timestamp: Date.now()
          });

          notifyBrowser(
            "💰 PRICE CHANGE",
            `${p.title}: $${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}`,
            p.url,
            false
          );

          sendWebhookEmbed({
            title: "💰 PRICE CHANGE",
            description: `**[${p.title}](${p.url})**`,
            url: p.url,
            color: 16766720,
            thumbnail: p.image
              ? { url: p.image }
              : undefined,
            fields: [
              {
                name: "Old Price",
                value: `$${oldPrice.toFixed(2)}`,
                inline: true
              },
              {
                name: "New Price",
                value: `$${newPrice.toFixed(2)}`,
                inline: true
              }
            ],
            timestamp: new Date().toISOString()
          });

          realAlerts++;
        }
      }

      /*
       * Update current state.
       */
      prev.available = effectiveAvailable;
      prev.quantity = effectiveQuantity;

      if (effectiveVariantId) {
        prev.variantId = effectiveVariantId;
      }

      prev.price = newPrice;
      prev.upcoming = p.upcoming;
      prev.image = p.image;
      prev.title = p.title;
      prev.url = p.url;

      /*
       * Remove blocked products and clean old numeric-key entries.
       */
      for (const k of Object.keys(itemsState)) {
        const itemHandle = itemsState[k]?.handle;

        if (
          itemHandle &&
          BLOCKED_HANDLES.includes(itemHandle)
        ) {
          delete itemsState[k];
          continue;
        }

        if (
          itemHandle === p.handle &&
          k !== key
        ) {
          itemsState[k].available = effectiveAvailable;
          itemsState[k].quantity = effectiveQuantity;

          if (effectiveVariantId) {
            itemsState[k].variantId = effectiveVariantId;
          }

          delete itemsState[k];
        }
      }
    }

    /*
     * Mark the baseline ONLY after the complete product scan succeeds.
     */
    if (!baselineEstablished) {
      await chrome.storage.local.set({
        mattelBaselineEstablished: true
      });

      console.log(
        `[BASELINE] Initial stock baseline established. Suppressed ${baselineChanges} false restock transitions.`
      );
    }

    saveState();

    console.log(
      `[SCAN] Completed. Products tracked: ${Object.keys(itemsState).length}`
    );

    console.log(
      `[SCAN] Alerts generated this scan: ${realAlerts}`
    );
  } catch (err) {
    console.error("[SCAN] Fatal scan error:", err);
  } finally {
    scanInProgress = false;
  }
}
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    const action =
      typeof msg === "string"
        ? msg
        : msg?.action;

    if (
      action === "scanNow"
    ) {
      scanMattel()
        .then(
          async () => {
            await scanUpcomingProducts();
            await scanHiddenProducts();
          }
        )
        .catch(err =>
          console.error(
            "[SCAN NOW]",
            err
          )
        );

      sendResponse({
        ok: true
      });

      return true;
    }

    if (
      action ===
      "PLAY_ALERT_SOUND"
    ) {
      /*
       * IMPORTANT:
       * The offscreen sound document handles
       * playback. Do not call playAlertSound()
       * here or it can recurse.
       */
      sendResponse({
        ok: true
      });

      return true;
    }

    if (
      action ===
      "TEST_DISCORD_WEBHOOK"
    ) {
      sendWebhookEmbed({
        title:
          "🧪 Mattel Tracker Connected!",

        description:
          "Your Discord webhook is working correctly.",

        color:
          5763719,

        fields: [
          {
            name:
              "Status",

            value:
              "🟢 Active",

            inline:
              true
          },

          {
            name:
              "Auto-Popout Mode",

            value:
              "Enabled",

            inline:
              true
          }
        ],

        timestamp:
          new Date().toISOString()
      })
        .then(() =>
          sendResponse({
            success:
              true
          })
        )
        .catch(err =>
          sendResponse({
            success:
              false,

            error:
              String(
                err?.message ||
                  err
              )
          })
        );

      return true;
    }

    if (
      action ===
      "getUpcomingProducts"
    ) {
      chrome.storage.local.get(
        ["upcomingProducts"],
        result => {
          sendResponse({
            products:
              result.upcomingProducts ||
              []
          });
        }
      );

      return true;
    }

    if (
      action ===
      "getHiddenProducts"
    ) {
      chrome.storage.local.get(
        [
          "hiddenProducts",
          "hiddenCount",
          "hiddenUpdated"
        ],
        result => {
          sendResponse({
            products:
              result.hiddenProducts ||
              [],

            count:
              result.hiddenCount ||
              0,

            updated:
              result.hiddenUpdated ||
              null
          });
        }
      );

      return true;
    }

    if (
      action ===
      "getDashboardData"
    ) {
      sendResponse({
        stats:
          generateDashboardStats(),

        products:
          Object.values(
            itemsState
          )
            .map(item => ({
              ...item,

              analytics:
                generateProductSummary(
                  item
                )
            }))
            .sort(
              (a, b) =>
                b.analytics
                  .healthScore -
                a.analytics
                  .healthScore
            )
      });

      return true;
    }

    if (
      action ===
      "CHECK_LIVE_STOCK"
    ) {
      checkLiveInventory(
        msg.handle
      )
        .then(stock => {
          sendResponse({
            quantity:
              stock
          });
        })
        .catch(err => {
          sendResponse({
            quantity:
              null,

            error:
              String(
                err?.message ||
                  err
              )
          });
        });

      return true;
    }

    return false;
  }
);

chrome.alarms.create(
  "mattelScan",
  {
    periodInMinutes: 5
  }
);

chrome.alarms.create(
  "mattelDiscoveryScan",
  {
    periodInMinutes: 15
  }
);

chrome.alarms.onAlarm.addListener(
  async alarm => {
    if (
      alarm.name ===
      "mattelScan"
    ) {
      await scanMattel();
    } else if (
      alarm.name ===
      "mattelDiscoveryScan"
    ) {
      await scanUpcomingProducts();
      await scanHiddenProducts();
    }
  }
);

chrome.runtime.onStartup.addListener(
  async () => {
    await scanMattel();

    setTimeout(() => {
      scanUpcomingProducts();
      scanHiddenProducts();
    }, 5000);
  }
);

chrome.runtime.onInstalled.addListener(
  async () => {
    await scanMattel();

    setTimeout(() => {
      scanUpcomingProducts();
      scanHiddenProducts();
    }, 5000);
  }
);