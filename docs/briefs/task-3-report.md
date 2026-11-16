# Shop / queue implementation evidence

Live read-only survey used the user's authenticated Chrome with BrowserSkill in an owned background window. No customer field values were output, stored in fixtures or sent to AI. Verified actual tRPC GET endpoint names and schema from static client bundles and selected response metadata. All customer form survey returned descriptors only (placeholder/type/required), never values.

The queue reader calls manager.order.getOrdersServerTable with createdAt ascending, pageSize50, no filtering and showFinishedfalse. It follows every server cursor, rejects missing coverage/repeated IDs/cursor loops/count changes, checks stable head after multipage coverage, then applies exact product/category catalog and native handled IDs. Dates use server ISO UTC, with strict Thai Buddhist +07 fallback. Sorting tied creation timestamps by orderId does not regroup maps.

Credential reads use manager.order.getOrder by exact orderId, verify variantId/status/creation time/deletedAt and exact field placeholders. Working editor is newly opened even if detail fails, never refreshed by scanner. Reader projects out customer notes, author data, product descriptions, images and all form values other than the two expected fields. All calls GET only through fixed same-origin injected function, no page script execution or website form submission.

Bundled catalog from public.category.getCategoryProducts was fully paged:146 ORDER variants (29 Cameraman,43 MM2,74 Skibidi). GIFT variants excluded. Three category IDs were verified from actual list data. Map names/place IDs verified via official Roblox universe/games endpoints. Saved catalog operator mappings start blank and require setup; no operator guesses.

Tests: `node --test tests/queue.test.mjs` passed9/9 before final integration. Coverage: global FIFO/ties, handled IDs namespace, bad dates, wrong categories/SKU/map target, bundle uniqueness, changed detail, duplicate credential labels, multi-page cursor coverage and stable head, unknown coverage/cursor loops/count changes, structured category cursor and GIFT exclusion, actual injected reader request/projection behavior.

Review rulings: native v30 receiver lacks group API, so never rewrite live AccountData to manufacture a group; workflow classification records customer association and native accounts stay Default or preserve existing metadata. Capabilities must state this limitation. A pending import that has already reached RAM cannot be undone; completion must wait for bounded settlement before another job is claimed. Cancellation before sending import must prevent it. These two cases require race tests, not a claim that abort can revoke a remotely committed import.

User approval covers building/installing isolated companion and extension; no real customer login was used as a smoke test. Production login selectors and human challenges still require first intentional live use after setup; this cannot be proven by fake fixtures alone.

Fix review: malformed/missing status/variant/category now raises SHOP_API_CHANGED before eligibility filtering. Focused10/10 queue tests passed, including the reproduced false-empty regression.
