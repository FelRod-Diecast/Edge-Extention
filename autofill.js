(async function () {
  const { autofillProfile } = await chrome.storage.local.get(["autofillProfile"]);
  if (!autofillProfile || !autofillProfile.email) return;

  function fillField(selectors, value) {
    if (!value) return;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.value) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }
  }

  function runAutofill() {
    // Shopify Checkout Field Selectors
    fillField(['input[name="email"]', 'input[type="email"]', '#checkout_email'], autofillProfile.email);
    fillField(['input[name="firstName"]', '#checkout_shipping_address_first_name'], autofillProfile.firstName);
    fillField(['input[name="lastName"]', '#checkout_shipping_address_last_name'], autofillProfile.lastName);
    fillField(['input[name="address1"]', '#checkout_shipping_address_address1'], autofillProfile.address);
    fillField(['input[name="city"]', '#checkout_shipping_address_city'], autofillProfile.city);
    fillField(['input[name="postalCode"]', '#checkout_shipping_address_zip'], autofillProfile.zip);
    fillField(['input[name="phone"]', '#checkout_shipping_address_phone'], autofillProfile.phone);
  }

  // Run autofill continuously while Shopify loads DOM elements dynamically
  runAutofill();
  const observer = new MutationObserver(runAutofill);
  observer.observe(document.body, { childList: true, subtree: true });
})();