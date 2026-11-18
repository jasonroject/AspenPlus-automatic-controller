# Published v2 query-byte guard review

Scope: read-only production review plus one new regression file, `universal_pipeline/published-query-guard.test.mjs`. No browser, HTTP recheck, COM, fit, production-source edit, or old test-suite rerun was performed by this agent.

## Resolved finding

Hashing `new TextEncoder().encode(await response.text())` does not prove original network-byte identity. `Response.text()` strips a UTF-8 BOM: prefixing the frozen v2 bundle with BOM bytes changes its raw size/hash, but re-encoding that decoded text still yields the original 66,286-byte content/hash. The one-off experiment is recorded in `query-byte-auth-audit.json`.

Root corrected the implementation to accept only `Uint8Array` in `verifyPublishedQueryBundle`. The dedicated public v2 bundle fetch reads `arrayBuffer()`, preserves the original bytes, decodes with fatal UTF-8 handling, and passes those bytes into the SHA256/size check. Text readers and local-file sources never obtain query permission.

## Current guard contract

- Only internally selected public `v2/model.bundle.json` and a qualified, non-exploratory v2 package index can be eligible.
- The index retains the exact expected bundle byte count and lowercase SHA256, copied from the reviewed file manifest.
- Web Crypto absence, rejection, a wrong digest, or a size mismatch returns false. No unverified fallback enables querying.
- Loading begins by clearing artifact/query permission. After the asynchronous digest, `active`, revision/ticket and captured index-object identity are checked before the result can commit.
- Version changes, local-file loads and unmounts invalidate pending work; replacing the captured index object prevents the permission flag even if the older digest later succeeds.
- File-byte agreement establishes equality to this published package. It does not independently authenticate Aspen execution or demonstrate physical validation.

## New regression results

`node --test universal_pipeline/published-query-guard.test.mjs` passed **11/11** checks (7 top-level tests, including 4 race subtests), with no skips.

Coverage: exact real v2 bytes; typed-array views with backing-buffer padding; rejection of strings/bare ArrayBuffer; CRLF normalization and JSON reserialization; same-length numeric mutation; wrong manifest size/hash; stripped-BOM counterexample; identical bytes from local/v1/non-bundle sources; unqualified index; unavailable/rejected Web Crypto; actual public loader vs identical local file; and delayed-digest races for version/local/index/unmount changes.

Numeric Matérn evaluation and training-hull applicability are a separate review after the numerical module is delivered.
