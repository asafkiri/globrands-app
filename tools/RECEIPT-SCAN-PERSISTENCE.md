# Receipt scan persistence — yotvata v330

Base inspected and reproduced: `7cd57a1fc12c30755436bb7db436c72ddf501412`.

## Root cause and reproduction

The application had three competing representations of the same paper: current
photo inputs, per-document in-memory caches, and the aggregate scan response.
Photo edits invalidated memory without immediately replacing the persisted draft.
Opening the image editor also cleared the aggregate response, so the serializer
omitted valid results belonging to other documents. Restore used old receipt
anchors for document shape, which could undo an addition/removal. Storage fallback
silently removed OCR; completed receipts stored only summaries/audit counts; active
receiving drafts had no cloud listener. Re-entering the discrepancy screen could
also repeat unchanged text analysis (automatic entry in Tnuva, explicit analyzer
requests in either application).

These four regression tests fail against the base and pass after the change:

| Action sequence | Original result | Verified result |
| --- | --- | --- |
| Scan → finish → edit images → delete page → reload | Deleted scan becomes valid again | Deleted scan stays invalid; completion is gated |
| Scan two papers → edit second → change count → reload | Both reads disappear | First read remains; only second paper is uploaded |
| Scan two papers → remove first → reload | Removed paper returns | One paper remains, reindexed, with recomputed anchors |
| Scan one paper → add unfinished second → reload | Unfinished paper disappears | Both inputs remain; incomplete paper blocks completion |

Fixture: paper with 10 units at 5 per unit, printed subtotal 50 and 1 item row;
physical count 9. Tnuva has no printed-unit anchor; Yotvata has 10 printed units.
The full module performs scan adaptation, paper checks, storage, restoration,
comparison and HTML generation. Expected visible shortage is 1 / 5.00. With two
papers it is 11 / 55.00. Photos/network replies are deterministic fixtures.
These are reproductions of the reported action sequences, not field invoices
from Tnuva/Yotvata supplied by the user.

## Changes

1. Each document owns a stable scan ID and parsed result. The aggregate response
   is derived from those inputs, preserving other documents and audit metadata.
2. Persist actual image/document mutations immediately. Prepare replacement images
   before invalidating the previous read; reject late preparation after cancellation.
   Opening the image editor alone does not invalidate OCR.
3. Restore current document shape, page counts and partial results. Validate cached
   paper before reuse; preserve legacy drafts. Recompute comparison from saved paper
   after count changes. A comparison exception keeps the paper and a visible retry.
4. Rebuild paper anchors after a review-screen rescan too. Unchanged documents use
   their cache. Fully cached review needs no network/upload. Keep the existing
   four-document/eight-page limits when some pages exist only as saved reads.
5. Show persistent local-storage failure/reduced-save messages and cloud status.
   A reduced local copy can recover OCR from its acknowledged cloud version.
6. Persist active receiving drafts in `dataPath('drafts', 'receipt')` with revisions
   and mutation IDs. Concurrent changes require a choice; the losing copy is kept
   under `receipt_backup_*` before replacement. Incoming asynchronous decoding and
   outgoing transactions guard against intervening local edits.
7. Store complete parsed source in the final receipt's `paperScan` field. JSON
   larger than 200 kB is gzip/base64 encoded; oversize data fails explicitly instead
   of truncating. Photos are excluded. The final receipt and closed draft commit
   atomically and retries use the same finalization ID.
8. Cache successful analyzer responses by draft ID plus the exact input (paper,
   quantities, catalog, promotions, anchors). Changed input requires fresh analysis;
   stale responses cannot affect a different evaluation or cancelled draft.
9. Persist legacy product-confirmation metadata. Preserve response identity during
   serialization so existing confirmation dialogs keep working.
10. Update the app version; update the service-worker cache to load it; add focused full-flow and Firestore integration tests.

Backend files, OCR models/prompts, pricing, VAT, promotions and unrelated screens
are outside this patch. The existing supplier-specific financial checks are used.

## Verification

- `65/65` app tests passed (`node --test tools/*test.mjs`).
- 2/2 integration tests passed for this app with Firebase SDK 11.6.1 and a local
  Firestore emulator: multi-device resume/finalization and conflicting transactions.
- Existing backend tests passed: Tnuva 12/12; Yotvata 9/9.
- Across both apps/backends: 157 passing tests, no skipped tests.
- Adjacent cases include matching totals with a different product, changed count,
  multiple pages, partial scan failure, reload during pending OCR, cancellation,
  failed image preparation, quota exhaustion, all local writes failing, offline
  edits, conflict resolution in either direction, edits during decompression,
  final write failure/retry, manual/no-document receiving, analyzer reuse/reload,
  changed analyzer input and late responses.

Run original four reproductions (expected failures):

```sh
git show 7cd57a1fc12c30755436bb7db436c72ddf501412:index.html > /tmp/yotvata-scan-before.html
RECEIPT_TEST_APP=/tmp/yotvata-scan-before.html node --test --test-name-pattern='removed photo|editing one document|removed document|added unfinished' tools/receipt-scan-persistence.test.mjs
```

Run the integration test with an already running local emulator and a dependency
directory containing Firebase 11.6.1:

```sh
RECEIPT_FIREBASE_TEST_DEPS=/path/to/test-dependencies FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node --test tools/receipt-firestore.integration.mjs
```

The integration adapter converts objects across the Node VM boundary with
`structuredClone`; it does not sanitize missing fields or fake commits. Each
simulated device uses a separate Firebase client. All paths are isolated beneath
an integration run in a `demo-*` project. The test refuses a non-local emulator.

## Remaining deployment verification

Browser Use rejected the local preview with `ERR_BLOCKED_BY_CLIENT`; there is no
claim of iPhone/Safari or visual browser verification. HTML assertions exercise
actual render functions but do not replace that device check. Production Firestore
rules and authenticated writes were not tested or changed: this repository does
not contain the deployed rules. Before merging/deploying, verify that the existing
app identity can read/write `drafts/receipt`, create `drafts/receipt_backup_*`, and
commit final receipt + draft transactions. Emulator rules permit test access and
do not establish production permissions. Both devices must load this version to
participate in the new draft protocol. No paid OCR request or production data
write was made by this test work.
