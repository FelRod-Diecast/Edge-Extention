# RLC Race Assist (Test)

Independent Manifest V3 test extension. It does not modify or depend on the working Mattel Tracker extension.

## Current prototype features
- Lets you paste a Mattel Creations product URL even when it is not in Upcoming.
- Offers a requested quantity from 1 to 20 for non-RLC products; RLC/Elite 64 products are clamped to 2.
- Saves manual products and discovered RLC candidates to the Race Assist watchlist.
- Checks selected products for availability on a scheduled alarm.
- On an observed unavailable-to-available transition, opens a Race Assist window and a Mattel cart permalink using the selected quantity.
- If a product is already available when added, it records that initial state rather than treating it as a new restock event.
- Does not solve CAPTCHA, bypass queues/security, evade rate limits, or automate the final purchase.

## Automated checks
A GitHub Actions workflow checks JavaScript syntax, manifest references, external script loading, and regression cases for quantity limits, URL validation, restock transition triggering, and duplicate-window prevention. These checks do not replace real Edge/Mattel browser testing.

## Important test status
This is still a test build. Real browser testing is required to verify Mattel's product JSON availability signals, actual quantity limits, browser alarm timing, and the cart handoff. Do not rely on it for a time-critical release until that testing is complete.

## Browser plan
Edge first, then Chrome, then Firefox after the first two are proven.