# Login-only native implementation — 2026-11-17

Implemented in `native/Host.cs`, `Pools.cs`, `Accounts.cs`, `Navigation.cs`, and `SelectionNavigationTests.cs`. Login/session integration and build exclusions are coordinated with the root task in `Login.cs`, `SelfTests.cs`, and `scripts/build-native.ps1`.

## Result

- Native messaging stays protocol v1. Capabilities report version `1.3.0`, `loginOnly:true`, `accountSelection:true`, `undoLast:true`, and `dualClientLaunch:false`.
- `GET_ACCOUNT_METADATA` returns only account ID, username, alias, description, and group. It does not expose tokens, destinations, or private links.
- Both role selectors accept saved RAM accounts. Customer also accepts the original order identity. RAM choices validate the existing session through injectable `readSavedAccounts` and `validateSavedSession` adapters; defaults use the existing RAM reader and authenticated identity validator. They never invoke RAM import.
- Customer selection replaces the customer role and increments generation, rotates completion token, and closes the owned browser asynchronously. Operator selection changes only the operator role, keeps generation, rotates completion token, and preserves an ongoing customer challenge. An unsettled import intent blocks account selection; a persisted session fingerprint or exited receiver permits safe recovery.
- Same known UserID in both roles is rejected. Before both IDs are known, matching nonempty usernames are compared without case. Automatic order imports continue to protect all configured operator IDs plus every operator selected in this job.
- Fresh jobs choose the first configured pool member, falling back to the legacy operator mapping. Reconnect revalidates the selected operator, or restores the default when the old ledger omitted it. RAM customer selections are revalidated as well. Existing job selections survive reconnect without changing settings or pool rotation state.
- Original `order.customerUsername` remains unchanged when a RAM customer is selected.

## Back and replay

- Snapshot adds `canUndo` and `historyTarget:{shopId,orderId,needsRestoreOrder}`. Handled history stays an array of metadata objects. No-current requests accept null expected job ID and generation.
- `UNDO_LAST` checks the exact visible current job/generation and last handled order ID. Restored jobs get new job IDs and completion tokens, and `order.revisit:true`. The current unhandled order is not added to handled history, so normal FIFO can claim it again.
- Old handled entries can be restored with sanitized `restoreOrder` supplied by the worker's metadata GET. Native validates required order metadata and exact shop/order identity before changing history. The worker remains responsible for configured/bundled SKU validation.
- A pending import must settle before Back changes the job. Protected IDs are the union of restored history, restored pool, current job protection, and optional `protectedOperatorUserIds` supplied from all configured operator mappings. The supplied IDs are validated and sorted into the replay fingerprint. This protects other product mappings even when restoring legacy history with no current job.
- Both mutations save command type and a normalized identity fingerprint with the mutation. Exact replays acknowledge without changing generation or history, including after ledger reload. Reusing a command ID for another request is rejected. Completion records carry their command type to prevent cross-command collisions.
- Back fingerprints its expected current and target identities. After a successful Back, later replay does not depend on refreshed legacy metadata and never pops the next entry.

## Game automation removal

`Host.cs` has no live-pair CLI, launch dispatch, launch self-test call, or game-close call on completion. `Pools.cs` has no launcher, rotation mutation, or private-destination helper. Loaded legacy game fields are discarded. Production build excludes `Launch.cs` and `LaunchTests.cs`; both remain archival source files only. Closing the owned login browser remains necessary for customer cancellation and completion.

## Verification

`scripts/build-native.ps1` passed on 2026-11-17, including compilation and the complete native self-test suite. A separate temporary test executable also compiled and passed before the production build.

New synthetic fixtures cover default operator mapping, operator selection during OTP challenge, old completion-token rejection, customer RAM choice without import, preservation of original order username, invalid stored session, identity/name conflicts, stale customer generation, import-intent refusal, late authenticated callback after customer selection, and absence of session secrets in ledger/snapshot.

Navigation fixtures cover stale visible current/target identities, pending-order return to FIFO, replay without a second history pop, lost ACK after ledger reload, command ID reuse, legacy metadata recovery, exact legacy target matching, null current identity, unsettled/settled import handling, and game-free operator recovery after loading old state.

Additional legacy fixtures verify no-current recovery protects an operator mapped to another product, blocks its automatic import, rejects invalid protected IDs, normalizes protected-ID ordering on replay, and rejects reuse with a different protected set.

All fixtures use temporary ledgers and synthetic accounts. Saved-account reads and validation are mocked; login receiver/authentication/import are mocked. No real customer login, AccountData secret read, authenticated network call, RAM write, game launch/close, or shop mutation was performed by these checks.

## Integration notes

- An invalid saved session becomes a selected role with `state:blocked` and a sanitized validator code. A missing selected ID fails with `RAM_ACCOUNT_NOT_FOUND`.
- Selection uses `jobId/generation` from the visible view; the worker serializes navigation/selection and records intent before sending. Completion additionally uses the rotating completion token.
- Validation of a saved RAM session is a read-only network request in production and may take up to the existing validator timeout. No live validation was exercised during development.
- Selection, Back, and completion resolve a settled import intent before proceeding; unresolved imports remain blocked. Selection fixtures cover both matching persisted fingerprints and exited receivers, plus unresolved intent retention.
- An earlier isolated build produced ignored `native/bin/BewpakornQueueSelectionTest.exe`. Automatic approval review rejected removal of that exact file with `blocked by policy`; the root task was informed to package only the explicit production host executable.
