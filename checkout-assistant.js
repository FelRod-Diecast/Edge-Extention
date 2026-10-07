(() => {
  "use strict";

  const PROFILE_KEY = "autofillProfile";
  const STATUS_ID = "mattelCheckoutAssistant";

  function isCheckoutPage() {
    const url = location.href.toLowerCase();
    return (
      url.includes("/checkouts/") ||
      url.includes("/checkout") ||
      url.includes("checkout.shopify.com")
    );
  }

  function isFinalPurchaseButton(el) {
    const text = String(el?.innerText || el?.value || "").trim().toLowerCase();
    return /pay now|place order|complete order|submit order|buy now|purchase/.test(text);
  }

  function buttonText(el) {
    return String(el?.innerText || el?.value || "").trim().toLowerCase();
  }

  function isAdvanceButton(el) {
    if (!el || isFinalPurchaseButton(el)) return false;
    const text = buttonText(el);
    return /continue to shipping|continue to payment|continue|next|review order/.test(text);
  }

  function ensureStatus() {
    let box = document.getElementById(STATUS_ID);
    if (box) return box;

    box = document.createElement("div");
    box.id = STATUS_ID;
    box.textContent = "⚡ Mattel Checkout Assistant active";
    Object.assign(box.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      padding: "8px 11px",
      borderRadius: "6px",
      background: "#111",
      color: "#fff",
      font: "600 12px Arial,sans-serif",
      boxShadow: "0 2px 12px rgba(0,0,0,.35)",
      pointerEvents: "none"
    });
    document.documentElement.appendChild(box);
    return box;
  }

  function setStatus(text) {
    const box = ensureStatus();
    box.textContent = text;
  }

  function nativeSet(el, value) {
    if (!el || !value || el.value) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  async function autofill() {
    const result = await chrome.storage.local.get([PROFILE_KEY]);
    const p = result.autofillProfile;
    if (!p?.email) return;

    const fields = [
      [['input[name="email"]', 'input[type="email"]', '#checkout_email'], p.email],
      [['input[name="firstName"]', '#checkout_shipping_address_first_name'], p.firstName],
      [['input[name="lastName"]', '#checkout_shipping_address_last_name'], p.lastName],
      [['input[name="address1"]', '#checkout_shipping_address_address1'], p.address],
      [['input[name="city"]', '#checkout_shipping_address_city'], p.city],
      [['input[name="postalCode"]', '#checkout_shipping_address_zip'], p.zip],
      [['input[name="phone"]', '#checkout_shipping_address_phone'], p.phone]
    ];

    let changed = false;
    for (const [selectors, value] of fields) {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (nativeSet(el, value)) {
          changed = true;
          break;
        }
      }
    }

    if (changed) setStatus("⚡ Mattel Checkout Assistant • info filled");
  }

  function findAdvanceButton() {
    const candidates = [
      ...document.querySelectorAll("button, input[type='submit'], [role='button']")
    ].filter(el => {
      if (el.disabled || !isAdvanceButton(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    return candidates[0] || null;
  }

  function advanceCheckout() {
    if (!isCheckoutPage()) return;

    // Never click the final purchase/payment action automatically.
    const btn = findAdvanceButton();
    if (!btn) return;

    const text = buttonText(btn);
    setStatus("⚡ Mattel Checkout Assistant • advancing");
    btn.click();
    console.log("[MATTEL CHECKOUT] Advanced checkout step:", text);
  }

  let lastUrl = location.href;
  let advanceTimer = null;

  async function run() {
    if (!isCheckoutPage()) return;
    ensureStatus();
    await autofill();

    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(advanceCheckout, 900);
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setStatus("⚡ Mattel Checkout Assistant • page changed");
    }
    run();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("load", run);
  setTimeout(run, 500);
  setTimeout(run, 1500);
  setInterval(run, 2500);

  console.log("[MATTEL CHECKOUT] Assistant loaded. CAPTCHA/queue remain user-controlled; final purchase is never auto-clicked.");
})();