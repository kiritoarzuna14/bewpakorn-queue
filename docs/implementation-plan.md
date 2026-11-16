# Bewpakorn Queue implementation — 2026-11-16

Approved design: ../../outputs/2026-11-16-bewpakorn-extension-design.md. User explicitly authorized implementation; continue without another design approval. New isolated source tree, no existing repository to worktree. Do not modify RAM binary or its live encrypted account file. Final deliverables go under outputs.

## Global constraints

Only explicitly cataloged map-service products; PROCESSING initial status; FIFO createdAt ascending, order ID tie break; scan all pages before selecting. One primary daily button `สำเร็จ`; only that action advances current job, including blocked or preparing. Never change shop status, trade, buy, or submit an order form. No auto start on install/startup. Customer and operator identities separate. Secrets only in transient memory and isolated customer WebView profile; no secret in logs, chrome.storage, reports, ledger or chat. Native RAM sessions stay encrypted. Existing account metadata unchanged. Explicit identity check before ready. Unknown inputs fail closed with actionable Thai codes. Cancellation/generation fences must prevent late import. Challenges remain human-controlled, no bypass or password retry loop. No live customer runs in development.

## Shared protocol (binding)

Native host name `com.bewpakorn.queue`. Frame UTF8 JSON length-prefixed UInt32LE, request max 256KiB, response max 1MiB. Requests `{v:1,id,type,payload}`. Response `{v:1,id,type:'RESULT',ok:true,payload}` or `{v:1,id,type:'RESULT',ok:false,error:{code}}`. Events `{v:1,type:'SNAPSHOT',payload:snapshot}`. No arbitrary URLs, filesystem commands, javascript, or cookie access commands exposed.

Commands:
- `GET_CAPABILITIES` => `{protocolVersion:1,version,webViewAvailable,ramImportSupported}`.
- `GET_ACCOUNT_METADATA` => `{accounts:[{userId,username,alias,description,group,placeId}]}` (no credentials/private server links).
- `GET_SNAPSHOT` => snapshot.
- `CLAIM_ORDER` payload `{order:{shopId:'bewpakorn.rdcw.xyz',orderId,productId,productName,mapId,mapName,placeId,operatorUserId,createdAt,customerUsername,quantity}}`. Native creates job and starts operator validation. Same order claim returns same current; different while busy rejects CURRENT_JOB_EXISTS. Handled rejects ORDER_ALREADY_HANDLED. Missing operator mapping creates blocked current, never skip.
- `PREPARE_CUSTOMER` payload `{jobId,generation,username,password}`. One auto submission maximum per job. Requires exact current username; refuses operator overlap, fenced cancel. Uses new dedicated WebView2 profile. Validated cookie imported to current RAM via existing receiver, then read-only persistence identity check. Challenge detection events pause submission; allow human manual completion within same context.
- `COMPLETE_CURRENT` payload `{commandId,jobId,orderId,generation,completionToken}`. Atomic handled ledger, closes only owned browser, idempotent replay, rejects stale token. Return snapshot. Do not select next internally.

Snapshot shape `{revision,current:null|job,handled:[{shopId,orderId,completedAt}],capabilities?:object}`. Job `{jobId,generation,completionToken,order,state:'preparing'|'ready'|'blocked',customer:{username,userId?,state:'waiting'|'preparing'|'ready'|'blocked',code?},operator:{username?,userId?,state,code?},code?}`. Persist no secret. On host restart retain job identity and token; unverified role becomes blocked RECOVERY_REQUIRED, never silently login again. Native named mutex prevents multiple host instances claiming separately.

Extension internal UI messages `{type:'UI_GET'|'UI_START'|'UI_COMPLETE'|'UI_OPTIONS_GET'|'UI_OPTIONS_SAVE'|'UI_ACCOUNTS',payload?}`. UI snapshot `{connection:'connected'|'disconnected',phase:'idle'|'scanning'|'working'|'empty'|'blocked',native:snapshot|null,queue:array,issue?:code,configured:boolean}`. Runtime responses `{ok:true,payload}` or `{ok:false,error:{code}}`. `UI_COMPLETE` must include visible job identity fields, not consult a newer job at dispatch. Broadcast `{type:'UI_STATE',payload:state}`.

Shop module exports async `scanOrders(config)` => array of metadata and `openAndReadOrder(order)` => `{tabId,username,password}` (password transient only). Only extension worker calls it. `scanOrders` must throw rather than claim global oldest if page coverage unknown. Export `defaultCatalog()` and optional `discoverCatalog()` for options. Catalog config `{version:1,catalog:[{productId,productName,mapId,mapName,placeId,operatorUserId}],shopOrigin:'https://bewpakorn.rdcw.xyz'}`. Product names are display only, IDs are eligibility authority.

## Task 1 — native host + isolated login

Owner `native/**`, `scripts/build-native.ps1`, `tests/native/**`. C# .NET Framework WinForms compatible with system csc, pinned official Microsoft.Web.WebView2 NuGet SDK DLLs. Fixed RAM path configured in host JSON; default known desktop bew path; never trust path from shop. DPAPI read-only adapter, atomic ledger save with corruption fail closed/backup, max sizes, named mutex. HTTP sessions validate Roblox ID with trusted fixed hosts, no secret diagnostics. WebView2 isolated customer context with host-only navigation allowlist and native role generation cancellation. Import waits for verified ACK and persisted ID; group capability must be proven before mutation, preserve native metadata. Implement protocol above; classify conservative errors. Build script downloads pinned dependencies with hash verification, compiles x64 host. `--self-test` pure/durable/frame tests using temp fixtures, no Roblox or live files. Report exact limitations. Do not commit others' files.

## Task 2 — extension worker, side panel, options

Owner `extension/**` except `extension/shop.js`, `extension/queue.js`, `extension/catalog.json` (root owns those). ES modules, no framework/network dependencies. MV3 exact shop host, sidePanel/storage/nativeMessaging/notifications/tabs and scripting only if shop connector needs it; no broad host, cookies, remote code. Stable public extension key generated via build setup. Native client envelope above; bounded request timeout, pending requests reject safely, state resync on reconnect. Persist completion intent BEFORE send, clear only ACK, reconcile after restart without auto claim. Toolbar intentional UI_START opens panel; startup only displays/reconciles. scan all pages once per selection, filter handled using queue.js. Claim then open current editor/read credentials then PREPARE_CUSTOMER; never persist creds. Credential read failure leaves claimed blocked job shown with issue and Success usable. Complete visible identity with native token. UI rejects double click and repeated Enter; new job controls arm after transition cooldown. Notify each new blocker once. Thai responsive 320px accessible UI with one daily main button, current order/map/product/quantity, two role cards, next queue. Options setup uses catalog discovery + account metadata mapping, explicit save, no passwords. Tests use mocks/fake data and Playwright can load HTML, no real customer. Assets locally bundled.

## Task 3 — queue, shop connector, integration (root)

Owner shop.js, queue.js, catalog.json, tests/shop/queue/integration, scripts/package/install/uninstall, docs. Survey current website read-only without exposing form secrets. Use authenticated same-origin read fetch in extension; parse DOM offscreen without executing scripts, never issue POST/PUT/DELETE. Exact product IDs in allowlist, structured data preferred; pagination coverage must be demonstrated including inactive/unknown pages. Date parser accepts exact Thai Buddhist time with +07:00 or verified ISO timestamp. Current edit tab newly opened as owned working tab; do not refresh unsaved user tabs. Credential extraction type/labels exact; never log result. Native import receiver recon read-only; report missing capabilities honestly. Build fresh package under outputs, include source + tests + installer, manual setup steps only where Chrome insists. Run safe native handshake/account metadata smoke, no customer login. Final broad independent review, fix important findings, fresh full check before claim.

## Execution ledger / preflight

| Tasks | Shared interface / own consistency | Finding / ruling |
|---|---|---|
| 1 / 2 | Native protocol and snapshot above | Binding contract; no local HTTP credential API introduced |
| 2 / 3 | shop.js and queue.js exports | Root owns modules; UI owner imports exact exports; root provides stubs early |
| 1 / 3 | native host build / installer | Build output native/bin, installer copies immutable release to LocalAppData, registers exact generated extension ID |
| 1 | Live RAM adapter / tests | Read-only DPAPI, actual imports only in explicit user-start; no live account-file mutation |
| 2 | Startup vs toolbar | Resync only on wake; intentional toolbar is only new-round start |
| 3 | Coverage vs FIFO | Unknown coverage blocks selection, cannot falsely declare empty |

Native source unavailable; standalone adapter rather than modifying proprietary binary. True native group write unsupported unless recon proves API; if absent, workflow records customer classification and UI displays it, with documented native-group limitation. Avoid unsafe encrypted-file rewriting to satisfy cosmetic group label. Implementation tasks have disjoint file ownership and fixed contracts; higher-level proactive delegation instruction permits parallel execution here despite generic skill's conflict warning. Review each task and integrated result.
