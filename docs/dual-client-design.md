# Dual Roblox clients and Cameraman pool — 1.1.0

User request: prepare and enter gameplay with two concurrently running Roblox clients, one customer and one operator. Three operator accounts rotate automatically: BewFNTH1, BewFNTH2, BewFNTH3. The user selected automatic rotation explicitly. Keep FIFO by order time and the single Success advance button. No game trade/buy/status-writing behavior is added.

Implementation choices are extensions to the approved system: local native launcher reuses the registered Roblox protocol and RAM's legitimate multi-client mode; never enable the broad RAM developer web API, inject code, close foreign handles, patch Roblox files, or terminate user clients. Credentials/tickets/private link codes remain native memory only. Source account metadata is read-only.

Current saved maps for FNTH1 and FNTH3 differ from Cameraman. Those are history hints, not authority over the user's explicit pool choice. All members target Cameraman place132929771812494 using the shared trusted saved private destination from FNTH2. Do not copy FNTH1/FNTH3's stale private targets. No plaintext private URL is returned to the extension.

On each new claim, native atomically assigns the next operator in configured order and persists rotation with the job. Resume/reconnect/repeated claim retain that assignment. A failed operator session blocks that job; never rotate repeatedly within the same order. Customer cannot overlap any configured pool/source account.

Each successful login is separate from game state. After both sessions are verified and the customer import is durable, launch operator then customer to the same private target. Verify distinct PID/start-time identities and simultaneous live processes, correct account IDs/place IDs, accepted joins and matching live server instance if logs expose it. A protocol-launch ACK alone is not 'in game'. Unknown outcomes stay blocked and do not auto retry. Human challenges remain human-controlled.

Success cancels pending pair launches and gracefully closes only the two clients owned by that job before advancing. It never closes Roblox opened by the user. If owned clients have not exited or launch ownership is uncertain, retain completion intent and show a pending cleanup code. Rotation does not alter order FIFO.

## Shared additions

Catalog item optional `operatorUserIds:string[]` and `privateServerSourceUserId:string`. Legacy `operatorUserId` remains for migration (first pool member/display only); native chooses actual member. All enabled products of a map must share identical ordered pool and private source.

CLAIM_ORDER order additionally includes those two fields; protectedOperatorUserIds contains the union of every pool plus target-source IDs. Native persists `rotation` in ledger, and `order.operatorUserId` is the selected actual member in snapshots. Pool UI lists all RAM accounts; saved place is a hint, not a hard exclusion. Private-source options must have a canonical saved private destination for the selected map.

Native API `LAUNCH_PAIR {jobId,generation}` starts/resumes only the current pair on intentional UI start when both sessions are ready. A fresh customer success may schedule its pair automatically because the active order was explicitly started. Never launch on startup/recovery alone. Snapshot roles add `game:{state:'waiting'|'preparing'|'connected'|'blocked'|'closed',code?,pid?,startTimeUtcTicks?,placeId?,serverInstanceId?}`. No tickets/cookies/link codes in snapshots or logs. Capability `dualClientLaunch:true`, `operatorPools:true`.

## Launcher module contract (native partial Host)

- `static Dictionary<string,object> LaunchPair(Dictionary<string,object> payload)` called with Gate held; validates current identity/session readiness and returns Snapshot immediately after scheduling.
- `static void MaybeSchedulePair(Dictionary<string,object> job)` called with Gate held after both verified sessions become ready; idempotent, no retry for uncertain prior launch.
- `static bool CloseOwnedPair(Dictionary<string,object> job)` called with Gate held from Complete; marks cancellation, initiates graceful close, returns true only after no active launch worker can spawn and all owned processes are confirmed exited. Never waits on a worker needing Gate.
- `static void LaunchSelfTests()` deterministic fixture tests, no real network/processes. Native launcher owner may add native/Launch.cs and native/LaunchTests.cs only; root integrates Host/Login/build hooks.

Native launcher resolves private destination by reading `order.privateServerSourceUserId` account Fields.SavedJobId, validates canonical HTTPS www.roblox.com/games/<order.placeId>?privateServerLinkCode and source SavedPlaceId, and rejects missing/mismatched target. Use fixed Roblox auth/user hosts and trusted registered protocol handler only. Guard generation/cancellation before every external launch. Unknown launch/cleanup must block rather than spawn duplicates.

Tests: durable rotation1→2→3→1; claims/resume not consuming extra turns; cross-map protection; saved-map mismatch explicit pool override; UI multi selection and shared target; fake two-client launch/close/cancel/reconnect; controlled real two-operator test if no unowned Roblox is open. Real test does no customer login and no trades; stop/close only test-owned clients.
