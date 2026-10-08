const params = new URLSearchParams(location.search);
const handle = params.get("handle");

document.getElementById("product").textContent = handle || "RLC product";

document.getElementById("focusCheckout").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ url: "https://creations.mattel.com/cart/*" });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  }
});
