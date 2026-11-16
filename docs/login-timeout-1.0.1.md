# LOGIN_FORM_TIMEOUT investigation and 1.0.1 fix

Two confirmed causes: the deployed code required an enabled #login-button before filling either input, while the empty form disables submission. A real public WebView probe additionally showed the current Sign in submit button has no legacy ID. The probe captured only field attributes/booleans and no customer data. The initial production-source regression failed (false !== true).

Shared LoginFormScripts now resolves legacy ID, the password field's unique form submit button, or a unique exact Sign in/Log in label. Input readiness does not require submit readiness. Host fills once, waits for enablement, then attempts one click. A durable submission flag precedes dispatch; only explicit PENDING/CHALLENGE no-click results clear it. Unknown results do not retry. Public diagnostic uses the exact same resolver/readiness implementation as production.

Green evidence: four source-script fixtures passed; real public WebView returned LOGIN_FORM_READY, buttonResolved=true, buttonDisabled=true, legacyButtonExists=false, customerLoginAttempted=false. Total Node tests25/25, native build/self-tests and 320px panel/settings checks passed. Settings test covers camera-only selection, exclusion of inactive maps and retained product/account choices.

Recovery applies only to the current pre-fill timeout without a prior submission/import. It retains the order and handled ledger, rotates fences and requires an intentional toolbar click. Native tests reject attempted/uncertain resumes. Worker test proves startup never resumes and a toolbar action prepares the same order rather than scanning the next.

Version1.0.1 native staged beside the running old host. Active Chrome extension path was verified from the exact extension preference entry as D:\BewpakornQueue-1.0.0\extension; all15 source files were copied and hashed after validating manifest name/public key. Ledger backup retained locally; staging did not modify current ledger or mark any order handled.

Windows Computer Use stopped activation because it could not determine Chrome's current URL confidently enough to enforce policy. No further UI input was attempted. Chrome Reload is still required to activate this release. Successful live customer authentication/import remains unverified.
