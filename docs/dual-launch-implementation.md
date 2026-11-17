> Historical design. Superseded by login-only mode 1.3.0; production no longer launches or closes Roblox. See protocol.md and login-only-navigation-plan.md.

# Native dual-client launcher

Owned implementation: `native/Launch.cs`, `native/LaunchTests.cs`. Host, login, pool, build and extension integration belong to the root task. No live clients or authentication requests were started during implementation.

The four agreed hooks are implemented. Scheduling records a sanitized intent before dispatch and starts a background worker. The worker validates distinct account IDs and the selected source account's canonical private destination, rechecks both sessions against Roblox, obtains separate tickets, then launches operator and customer through the trusted installed Roblox protocol. It reads RAM without rewriting its database/settings and uses the existing single RAM process with built-in multi-client mode. It does not enable RAM's developer API, patch Roblox, inject code, or close foreign handles.

The protocol command must point to a known Roblox player/launcher executable under installed Roblox Versions roots. WinVerifyTrust must validate its signature and its signing certificate must identify Roblox Corporation. Network requests are bounded, use fixed Roblox hosts, and disable automatic redirects. Private-page redirects are checked for the same official host, place and private link code.

Ownership uses exact in-memory authentication-ticket command-line fields plus process start time. Each role gets a persisted PID/start-time identity only after that proof. The production log reader uses read-only Restart Manager resource queries before and after reading, requiring the log writer's PID and process FILETIME to match that owned identity. API failure blocks evidence; there is no timestamp-only fallback. Only the newest owned log is considered.

Connection evidence is scoped to the current sequence beginning at the last Joining game marker. Account identity, place, RequestPrivateGame, accepted network connection and entered session must all belong to that sequence. Disconnect, teleport and end markers invalidate it. At the final pair barrier both processes must still be alive, both current logs are re-read, and each join sequence and server GUID must remain unchanged. The two instance GUIDs must match. Gameplay rendering still requires observation and is not claimed by logs.

Duplicate requests reuse the same run. Persisted attempts without their worker never launch again automatically. Cancellation shares a lock with the actual shell dispatch, and completion never waits under that lock. Cancellation after a dispatched but delayed launch continues ticket-based discovery, then closes only proven owned processes. Cleanup uses CloseMainWindow without Kill. Unknown ownership or a surviving owned client keeps completion pending. Fully cleaned in-memory entries are retired; their durable closed state continues to prevent duplicate launch.

Tickets, cookies, protocol URIs and private targets remain in native memory; per-attempt references are cleared when finished. Ledger/report fields contain only lifecycle state, error code, identity, place, PID/start time and server GUID.

## Validation performed

- Compiled all current native source with the system x64 .NET Framework compiler and a temporary fixture entry point.
- Deterministic fixture suite passed: simultaneous pair, identical server requirement, duplicate requests, stale map history override with the explicit common target, wrong map/identity/private evidence, cancellation before the second launch, late owned PID discovery after cancellation, uncertain ownership blocking retry/advance, recovered ownership cleanup, and absence of secrets from job state. Additional regressions reject old-join evidence mixing and operator disconnect/teleport between its first evidence and the final pair barrier.
- Read-only parser checks against recent local logs extracted current connected sequences with instance GUIDs, rejecting historical disconnected sequences. Only aggregate counts were printed.
- A separate temporary-file probe verified Restart Manager identifies the current test process by PID plus FILETIME and rejects a deliberately wrong start time. It called only start/register/list/end APIs.

Required additional references are `System.Management.dll` and `System.Web.dll`. No other assembly beyond the existing build references is needed.

## Explicit live harness

`LiveOwnedPairTest(string baseDir)` is available for the root-owned `--pair-self-test-live` CLI branch. It reads the staged/installed local config, uses temporary sanitized ledger/report files, and tests only the user's two designated existing operator accounts in opposite roles. It requires zero existing Roblox players, launches through the production module, allows a 15-second observation interval after connection, and always requests graceful closure of its own clients. It prints the temporary result path and safe outcome fields. It does not import a customer, change private links, trade, or change remote privacy settings. `renderedGameplayVerified` remains false for separate visual verification.

The implementation agent has not run this live harness; the root task owns the authorized controlled live test and final outcome.

Restart Manager definitions follow Microsoft's [RM_UNIQUE_PROCESS](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/ns-restartmanager-rm_unique_process) and [RM_PROCESS_INFO](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/ns-restartmanager-rm_process_info) documentation. The implementation never calls Restart Manager shutdown or restart functions.
