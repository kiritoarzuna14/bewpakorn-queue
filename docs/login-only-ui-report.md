# Login-only UI implementation report — 2026-11-17

Implemented the frontend portion of `docs/login-only-navigation-plan.md`. The panel retains Success and Back and restores the operator card. Both cards have explicit labeled native selects. The customer can choose the original order account or an existing RAM account; the operator can choose an existing RAM account. Each choice applies only to the current job. The original order username remains in `order.customerUsername` and in the order option even when the customer uses a RAM override.

## Worker behavior

- Requires native `loginOnly`, `accountSelection`, `undoLast`, and RAM import capabilities before starting or changing jobs.
- `UI_ACCOUNTS` reads native metadata and publishes only `userId` and `username`. The panel caches these safe fields. A newly ready imported customer refreshes the list, keyed by job, generation, and UserID.
- `UI_SELECT_ACCOUNT` binds the displayed job, generation, order, and completion token. It adds a random command ID and stores the complete secret-free mutation intent before sending native `SELECT_ACCOUNT`. Operator choices do not read credentials or restart customer login. RAM customer choices do not read order credentials or import an account. Returning to the order choice reads the current order afresh and prepares only the acknowledged current waiting customer.
- `UI_UNDO` captures current identity and last handled target before any await. It checks these identities again after sync and metadata retrieval. Native receives command ID, expected current ID/generation (explicit null when empty), expected last order, and the exact current protected operator ID set. Old history metadata comes from `readOrderMetadata` without a password. Known CANCELLED, REFUNDED, and FAILED revisits stay viewable without reading credentials or starting login.
- Navigation and selection are mutually exclusive with Success. The panel disables all four controls during a request, and the worker fences overlapping calls. Back refuses an outstanding completion intent before sync and cannot advance Success while it prepares a revisit.
- Lost native replies preserve the original mutation intent and command ID. Poll/reconnect replays that exact command, relying on native idempotence; Back cannot pop another history item. The intent remains through the credential-read continuation so a worker restart after native ACK can still prepare a waiting order. Definitive native rejection clears the rejected intent; transport failure and `RAM_IMPORT_UNCERTAIN` retain it.
- Global protected operator IDs survive disabled map saves. Claims and Back send the union of the global IDs and configured map account fields. Saving options retains the union of previous/incoming global IDs and previous/incoming map account fields. Per-job role selection never writes configuration.

## Panel behavior

The operator card is restored, both selects have visible associated labels, and both are constrained to the card width at 320px. Option text uses DOM text APIs. Select interaction captures the visible identity at pointer/focus/keyboard initiation; a change crossing a job update retains the older identity for worker rejection. Legacy game/pair error messages are omitted from the view. UI actions have no launch, game close, pair, or private-target command path.

## Verification

- Extension unit suite: **19 passed, 0 failed** (`node --test tests/extension/*.test.mjs`).
- New synthetic fixtures cover both roles, fresh order preparation, safe metadata, no credentials on RAM choices, unchanged config during selection, duplicate/stale Back, missing legacy metadata, null current identity, cancelled history, captured identity across metadata await, completion overlap, outstanding completion non-advancement, definitive rejection, unsettled import retry, lost selection ACK, lost Back ACK with exactly one history removal, protected IDs on Back, and protected IDs retained by settings save.
- Existing preparation/resume/completion fixtures remain passing; capability mocks now describe the login-only native contract. The prior pair-cleanup worker fixture now tests import settlement instead.
- Headless Chrome synthetic panel smoke passed at **320×850** (`node tests/extension/panel-browser.cjs` with bundled Playwright on NODE_PATH). It verifies two labeled cards, customer order + RAM options, operator RAM options, all controls locked during requests, rendered identities on selector/Back payloads, stale interaction identity capture, hidden legacy game errors, and no horizontal overflow.
- Screenshot: `docs/login-only-panel-320.png` (synthetic accounts and order only).

No live customer login, live shop mutation, RAM store editing, or game/process launch/close was performed. Native adapter validation and release/install checks belong to the native/root integration report.
