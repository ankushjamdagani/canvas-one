```json
{
  "verdict": "PASS",
  "blockers": []
}
```

**Reasoning (compact):**

**Allow path:** call → id2.id3 → transition id10 wraps input in list → data id41 → pipeline id12 validates each row against id4 (rows already match id4 shape → success batch nonempty → id14) → data id42 → decision id17 reads `input[0].payment == "allow"` → true → id19 outputs `input[0]` (id4) → data id43 → id22.id23 → transition id28 emits message id26 then replies succeeded. Data chain preserves original call frame throughout; reply in id22 is valid per "descendant reached through data edges." `correlation:{kind:'current'}` on message emit resolves to propagated invocation request ID. ✓ Assertions: root/succeeded=1, root/rejected=0, message/generated=1, message/succeeded=1 (broker→processor, failureRate=0), root/inFlight=0. All hold.

**Deny path:** decision fallback fires → id20 → id22.id24 → transition id32 replies rejected only, no message emit. ✓ Assertions: root/succeeded=0, root/rejected=1, message/generated=0, message/succeeded=0. All hold.

**Invalid path (not exercised in either scenario):** transition id34 replies `input[0]` (id4) with rejected — correctly typed against responseSchemaId id4 on id3. ✓

**Frame/reply**: id2 never issues its own reply; id22 settles the frame through the all-data edge chain — explicitly permitted by rules. No double-reply possible (single accepted/denied/invalid transition fires per invocation). Pipeline empty-batch rule: single-row input validates successfully in allow, so error branch produces no emission and does not trigger id22.id25. ✓
