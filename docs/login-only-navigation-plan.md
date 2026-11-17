# Login-only queue, Back, and role selectors — 2026-11-17

User explicitly removes game launch automation. Automatic order login through isolated browser and verified RAM import remain. User opens games manually. Add Back to previous handled order and account selectors on BOTH customer/operator cards. User confirmed customer choice is BOTH the order credentials and existing RAM accounts. Settings/map FIFO remain.

Existing working changes partially implement customer-only mode and Undo. Preserve those changes; complete the requested operator card/selection and harden history recovery. No live customer login, game launch/close or shop mutation in development. Never touch RAM encrypted store directly.

## Contract

Keep native messaging v1. New capabilities `loginOnly:true`, `accountSelection:true`, `undoLast:true`, `dualClientLaunch:false`. Native release1.3.0. Production build must exclude Launch.cs/LaunchTests.cs and live-pair CLI; no game launch, game close, private-target or multi-client lifecycle from any UI action.

Roles keep username/userId/state/code, add customer.source='order'|'ram'. Operator.source='ram'. Customer default uses fresh order credentials, verifies identity and imports as before; choosing RAM uses existing native session read-only and never overwrites/imports that account. Operator chooses existing RAM account. Refuse same UserID in both roles. Preserve protected operator IDs for automatic order imports. Selectors affect only this job; no settings/rotation changes.

`SELECT_ACCOUNT` payload `{commandId,jobId,generation,role:'customer'|'operator',source:'order'|'ram',userId?}`. Native validates stale job and duplicate command. Customer switch cancels old login by rotating generation + completionToken and closes only owned browser. RAM source verifies stored account identity/session through injectable validator and returns sanitized role state. Order source clears previous customer selection, returns waiting; worker then reads current order credentials and PREPARE_CUSTOMER. Operator selection must not cancel customer challenge/login; keep job generation, rotate completionToken, tighten protected IDs and refuse identity overlap with customer. No selection while an unsettled import exists. No secret in payload/storage/logs.

`UI_SELECT_ACCOUNT` passes visible identity + role/source/id; worker adds commandId, persists mutation intent before sending, clears only ACK and reconciles on reconnect. Disallow navigation/selection overlap; UI disables controls during request. One click/change consumes one command; stale rendered identity cannot affect next job.

`UNDO_LAST` payload `{commandId,expectedJobId,expectedGeneration,expectedLastOrderId,restoreOrder?}`. Persist navigation intent before mutation. Native replay returns ACK, never pops a second history entry. Validate current+target identities; retain current unhandled order for normal FIFO. Restore last handled with new job identity/token; remove only that handled entry. Current pending import must settle before switching. Historical entries from old releases lack metadata: worker reads safe metadata for target order from shop then supplies restoreOrder, validates configured/bundled map SKU, keeps target ID exact. No credentials in history. Revisited PROCESSING/COMPLETED orders may be read on explicit Back; cancelled/refunded stay viewable but do not auto-login. Back is extension history only, never website status mutation.

Keep original customer's username in order.customerUsername even when selecting a RAM customer; do not relabel RAM override as original order identity.

## Ownership / checks

1. Native owner: Host.cs, Pools.cs, new Accounts.cs/Navigation.cs, native selection/navigation tests. Root owns Login.cs and build exclusions. Hook `ValidateSavedSession(account,id)` injectable uses existing ValidateOperator; root aligns UpdateJobState for two session roles. Native helpers may call CloseLogin/UpdateJobState/Save under Gate; no blocking wait for callbacks.
2. UI owner: worker.js, panel.js/html, messages.js, style.css, extension tests. Root owns shop.js/queue.js metadata helper and credential revisit checks. Worker imports `readOrderMetadata(orderId,config)` async => sanitized order shape, no password. Panel dropdown RAM metadata loaded by UI_ACCOUNTS; current order option and both role controls; responsive320px. KeepSuccess+Back.
3. Root: strip game runtime, shop metadata/revisit, integrate, tests, versioned install and real loaded extension copy. Verify all unit/native tests, role switching race, idempotent Back/lost ACK, old history, no launch/close path, browser320. Preserve current live ledger during staging, no real order started. Chrome Reload may remain manual due known native UI limitations.

UI smoke and native fixture tests use synthetic accounts only. Session validation adapter must be mocked in native tests. Legacy application history metadata recovery reads GET only, no form submission, no password outputs.
