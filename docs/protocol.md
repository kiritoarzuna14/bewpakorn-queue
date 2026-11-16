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
- `PREPARE_CUSTOMER` payload `{jobId,generation,username,password}`. The list API has no Roblox username: CLAIM_ORDER accepts an empty customerUsername; PREPARE_CUSTOMER binds it once from the freshly read detail. Any later preparation must match the bound username and is never another automatic submission. Refuses operator overlap, fenced cancel. Uses new dedicated WebView2 profile. Validated cookie imported to current RAM via existing receiver, then read-only persistence identity check. Challenge detection events pause submission; allow human manual completion within same context.
- `COMPLETE_CURRENT` payload `{commandId,jobId,orderId,generation,completionToken}`. Atomic handled ledger, closes only owned browser, idempotent replay, rejects stale token. Return snapshot. Do not select next internally.

Snapshot shape `{revision,current:null|job,handled:[{shopId,orderId,completedAt}],capabilities?:object}`. Job `{jobId,generation,completionToken,order,state:'preparing'|'ready'|'blocked',customer:{username,userId?,state:'waiting'|'preparing'|'ready'|'blocked',code?},operator:{username?,userId?,state,code?},code?}`. Persist no secret. On host restart retain job identity and token; unverified role becomes blocked RECOVERY_REQUIRED, never silently login again. Native named mutex prevents multiple host instances claiming separately.

Extension internal UI messages `{type:'UI_GET'|'UI_START'|'UI_COMPLETE'|'UI_OPTIONS_GET'|'UI_OPTIONS_SAVE'|'UI_ACCOUNTS',payload?}`. UI snapshot `{connection:'connected'|'disconnected',phase:'idle'|'scanning'|'working'|'empty'|'blocked',native:snapshot|null,queue:array,issue?:code,configured:boolean}`. Runtime responses `{ok:true,payload}` or `{ok:false,error:{code}}`. `UI_COMPLETE` must include visible job identity fields, not consult a newer job at dispatch. Broadcast `{type:'UI_STATE',payload:state}`.

Shop module exports async `scanOrders(config)` => array of metadata and `openAndReadOrder(order)` => `{tabId,username,password}` (password transient only). Only extension worker calls it. `scanOrders` must throw rather than claim global oldest if page coverage unknown. Export `defaultCatalog()` and optional `discoverCatalog()` for options. Catalog config `{version:1,catalog:[{productId,productName,mapId,mapName,placeId,operatorUserId}],shopOrigin:'https://bewpakorn.rdcw.xyz'}`. Product names are display only, IDs are eligibility authority.

