**Verdict: REVISE** — 6 correctness/implementability gaps, 5 minor ambiguities.

---

## Critical gaps

### C1. `history.publish` missing `expectedProjectRevision`

**transactions.md** explicitly states: *"publication takes a fresh expected project revision after evidence save"* — meaning the candidate's structural token intentionally omits project revision (so run saves don't stale it), and publish must supply one separately.

But the payload is `{candidateId,publicationId,mergeCommitId,metadata,evidence,keepSourceOpen}` — no `expectedProjectRevision`.

**Fix:** Add `expectedProjectRevision:Revision` to the `history.publish` payload. This is the project revision read *after* evidence is saved, distinct from the prepare-time token inside the candidate.

---

### C2. `project.rename` envelope is undefined

Table says *"plus project revision in branch envelope."* The branch envelope is `{commandId,operationId,projectId,branchId,expectedWorkingRevision,actor,payload}`. The project-scoped envelope replaces branch fields with `expectedProjectRevision`. A hybrid (both `expectedWorkingRevision` and `expectedProjectRevision`) is neither defined nor valid by the context boundary.

transactions.md confirms rename compares its project revision in addition to the normal branch revision check, but gives no envelope form for this.

**Fix:** Either (a) define a combined envelope `{…branchFields,expectedProjectRevision:Revision}` explicitly for this command, or (b) put `expectedProjectRevision:Revision` in the payload alongside `title:string` and document that this command uses branch envelope + extended payload. Pick one and close it.

---

### C3. `EvidenceRef` type undefined

Both `history.commit` and `history.publish` take `evidence:EvidenceRef[]`. The type never appears in any of the three contracts. The all-scenario-pass rule requires the server to match evidence to configured scenarios, which requires knowing the `EvidenceRef` schema.

**Fix:** Close `EvidenceRef` — minimally `{scenarioId:Id,runId:Id,snapshotId:Hash}`. Add to the "Context and result boundary" type glossary.

---

### C4. `dependencyPreviewId` has no generating command

`selection.delete` and `part.capture` consume a `dependencyPreviewId` that *"binds exact branch revision and enumerated removal/reference repairs."* No registry entry produces this token. It's neither an authored command result nor a defined controller result kind (`draft`, `candidate`, `run`, `download` — not a dependency preview token).

**Fix:** Either (a) add a controller command `selection.preview-delete → {kind:'dependencyPreview',dependencyPreviewId:Id,boundRevision:Revision,removals:Id[],repairs:Id[]}` to the controller result union and register it, or (b) state explicitly that this is a local UI token computed in the adapter layer, define its schema, and document the failure code when stale (`failed[stale-token]` or extend `stale` to cover it).

---

### C5. Restore-into-main contradiction

`command-inventory.md`: *"Main direct commits and restore into main are disabled."*

`transactions.md` history table: *"Restore affects only a working draft, not published history"* — with no mention of main being forbidden.

These contradict. One contract permits restore-into-main-working-draft; the other forbids it entirely.

**Fix:** transactions.md must add an explicit row precondition or footnote: *"restore into main branch rejects; caller must branch.create(source=working) then switch."* Both contracts must agree.

---

### C6. No failure code for duplicate version key

`publication-metadata.md`: *"Enforce uniqueness of [projectId+versionKey] in the same transaction … concurrent attempts reject stale or duplicate version."*

The `failed` union codes are: `quota|unavailable|referenced-artifact|operation-id-reused|limit|ineligible|conflict|unsupported-version`. None clearly maps to "version key already exists." `conflict` is the closest but is already used for merge conflicts.

**Fix:** Either map duplicate version key explicitly to `failed[conflict]` in the publication section, or add `'duplicate-version'` to the failure code union. Document which code the consumer should expect for this case.

---

## Implementability ambiguities (REVISE)

### A1. `history.resolve-conflict` — superseded candidateId rejection code unspecified

Each resolution creates a new `candidateId` and *"invalidates the old candidate's eligibility."* But what status does sending a superseded candidateId return? `failed[ineligible]`? `missing`? Consumers need to distinguish "candidate gone" from "candidate structurally wrong."

**Fix:** State that a superseded candidateId returns `failed[ineligible]` and document this in the candidate lifecycle note.

---

### A2. `branch.create` — `expectedHeadId` validation conditionality

For `source:'working'`, the caller pins the current working revision via the branch envelope. `expectedHeadId` also appears in the payload. If a commit occurs between the caller's read and the create, the head advances but working revision is unchanged — `expectedWorkingRevision` would pass, `expectedHeadId` would reject.

Is `expectedHeadId` always validated regardless of `source`? Or only for `source:'head'`?

**Fix:** Explicitly state: "`expectedHeadId` is always validated regardless of `source`; it prevents committing to the wrong ancestry baseline."

---

### A3. `part.capture` — `revision` field is redundant and error-prone

The contract states: *"revision must be `expectedLatestRevision+1`, or `1` when `null`."* The value of `revision` is therefore fully determined by `expectedLatestRevision`. A caller who passes `revision=5, expectedLatestRevision=3` must be rejected, but the rule for that rejection isn't given a failure code.

**Fix:** Either remove `revision` from the payload (server computes it) and return the assigned revision in the `artifact` result value, or keep it and explicitly state that mismatch returns `invalid` with an issues entry on `revision`.

---

### A4. `panel.resize` — clamp vs reject for invalid values ambiguous

*"clamp only interactive geometry, reject invalid persisted records"* — both reach the server via the same `panel.resize` command. The contract gives no way for the command to distinguish interactive from persistence-restore context. If both paths use the same command, one policy must apply uniformly.

**Fix:** State which policy applies to the command boundary: either always clamp (and fix persistence at read time before submitting the command), or always reject out-of-bounds values (and require callers to clamp before issuing the command). Remove the dual-path language from the command table row.

---

### A5. Preference envelope type for zoom/fit/pan commands is implicit

`canvas.zoom-in/zoom-out/fit` write preferences only, meaning they use `{expectedPreferenceRevision,payload}`. But the table mixes them with branch-envelope commands without marking the envelope type. Same applies to `panel.*` commands. Consumers must infer envelope type from the "preferences only" annotation.

**Fix:** Add an envelope-type column or marker to the registry table (e.g., `(pref)` suffix), or explicitly state in the table header: *"rows annotated 'preferences only' use the preference envelope; all others use the branch envelope unless noted."*
