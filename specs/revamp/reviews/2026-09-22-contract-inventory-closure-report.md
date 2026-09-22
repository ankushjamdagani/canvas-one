**PASS** — all 11 findings resolved in the provided artifacts. One cross-document caveat.

---

**C1** — `expectedProjectRevision:Revision` present in `history.publish` payload. Resolved.

**C2** — `{title:string,expectedProjectRevision:Revision}` in payload + explicit `(branch envelope)` annotation. Option (b) implemented. Resolved.

**C3** — `EvidenceRef={scenarioId:Id,fingerprint:string,runId:Id}` defined in boundary section. Fingerprint used, not snapshotId — satisfies the "snapshot equality must not replace executable fingerprint equality" constraint. Resolved.

**C4** — `previewDependencies` defined as explicit local controller method with full return schema. Failure codes (stale/missing/invalid) enumerated. Resolved.

**C5** — command-inventory.md now explicit: *"Main direct commits and restore into main are disabled."* **Unverifiable half:** the fix required transactions.md to add a matching precondition row. transactions.md is listed as modified in git status but not provided. Cannot confirm cross-document agreement from these artifacts alone.

**C6** — `'duplicate-version'` added to failed code union. publication-metadata.md maps the case explicitly. Resolved.

**A1** — Superseded candidateId → `failed[ineligible]`; reload-expired/unknown → `missing`. Resolved.

**A2** — `expectedHeadId` always validated regardless of source; `HEAD_MOVED` code on mismatch vs `stale` on revision mismatch. Resolved.

**A3** — `revision` retained; mismatch returns `invalid` with issue path `payload.revision`. Resolved.

**A4** — Command rejects out-of-bounds; gesture layer clamps before issuing. Single-policy at command boundary. Resolved.

**A5** — Explicit envelope classification paragraph covers all categories. Resolved.

---

**Remaining action:** Confirm transactions.md now carries the restore-into-main precondition to close C5 fully.
