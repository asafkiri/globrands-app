# v325 — photo first receiving

The default receipt entry screen accepts up to four invoices and eight pages.
Pages of one invoice remain grouped; a separate driver invoice gets its own
card. After orientation confirmation, “התחל קליטת מוצרים” opens the existing
barcode flow while the invoice is decoded in the background.

Only printed summary values that close against that invoice's rows become
anchors. The original receipt count is never populated from OCR. Finishing
compares individual products even when grand totals happen to match.
Manual entry, explicit no-units waiver, deposits, no-document receiving and
attaching a later invoice retain their existing rules. No Berman promotion
rules were copied.

Completed reads and per-call model audits are checkpointed in the local draft
after each invoice. Images remain in memory. Refreshing during an unfinished
read preserves the physical counts and completed reads, and requests the
unfinished invoice's images again. It never silently repeats an upload.
Cancelling a receipt prevents its pending OCR from writing into a new receipt.
Final receipt records contain `scanAudit`; their expanded history shows model
attempts and outcomes.

An ambiguous network failure does not automatically re-submit a paid invoice
POST. A deliberate continuation reuses completed invoices and submits only
uncached ones. Automatic photo rotation retries are disabled for photo-first
receipts, whose orientation was explicitly confirmed before submission.

## Validation

`node --test tools/photo-first-test.mjs`

Tests execute the actual inline app functions, including the physical count,
reconciliation evaluator, draft restore, renderer's review gate and legacy
manual finishing path. All inputs are synthetic. No Firebase writes or paid
model requests are made. Browser testing of the local preview was blocked by
the execution environment; an iPhone test remains required.

## Real-device acceptance (after server v145 and app v325 are released)

1. Confirm the visible v325 badge. Open receiving and photograph every page,
   including the last page's summary/signature. Add a separate card for a driver
   invoice, if present.
2. Start receiving and scan/count products immediately. OCR progress must not
   close the scanner or replace an active quantity field.
3. Finish: verify the printed subtotal, units and actual item quantities.
   Correct a counted quantity and return to review: no new OCR request should
   be sent.
4. Save and expand the receipt's scan details. Check the model(s), retry stages
   and results. Inspect Cloud Run `invoice_scan_audit` if needed.
5. Compare with the actual paper before proceeding to the Tnuva implementation.

Deploy the existing scanner service first: app v325 checks for service v145+
and `photoFirst:true` before sending an invoice image. An older service offers
manual fallback and receives no paid photo-first request.
