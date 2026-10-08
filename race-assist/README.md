# RLC Race Assist (Test)

Independent Manifest V3 test extension. It does not modify or depend on the working Mattel Tracker extension.

## Prototype
- Independently discovers RLC/Elite 64 product handles from Mattel pages.
- Lets you opt specific products into **Need checkout assistance**.
- Stores the watchlist in its own extension storage.
- Checks selected products for live availability.
- When a selected product becomes available, resolves an available variant, prepares quantity **2**, opens a Race Assist window, and opens the direct Shopify cart.
- Observes checkout pages for CAPTCHA, queue/waiting-room, and checkout states without attempting to defeat or solve them.
- Stops short of final purchase automation.

## Browser plan
Edge first, then Chrome, then Firefox after the first two are proven.

## Important
Chrome/Edge extensions have isolated storage, so this prototype maintains its own discovery/watchlist. A later integration can use an explicit handoff from the production extension without modifying production during this test phase.

## Safety boundary
No CAPTCHA solving/bypass, queue bypass, rate-limit evasion, quantity-limit bypass, multiple-account checkout, or automatic final purchase.