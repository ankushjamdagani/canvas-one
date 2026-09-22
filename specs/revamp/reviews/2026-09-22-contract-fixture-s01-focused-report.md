```json
{
  "verdict": "PASS",
  "blockers": []
}
```

Trace of key decisions:

- **Guard ordering (id29 → id32 → id42)**: stable edge-ID order evaluated correctly. id29 (outcome=succeeded AND requestId match) takes priority; id32 catches matched-requestId non-success; id42 catches unmatched (stale). No overlap gaps.
- **`every` itemGuard**: `input` correctly refers to the current list item drawn from `context.items`, not the empty submit-event payload. `input.quantity` resolves to the item field.
- **`emit.correlation` in id17**: `request-id` effect (id16) runs first, writing `context.active`; correlation path `["active"]` then reads a nonempty string. Ordering correct.
- **S94 stale-response path**: first boundary response (afterInputId=id98) releases after resubmit; by then `context.active` holds the new request ID, so old response falls to id42 trace. Second response (afterInputId=null) settles second call with matching requestId → id29 → ui-success. Assertions (stale=1, order-command=2, ui-success=1, final=id11) match causal trace.
- **S84 duplicate submit**: id87 fires id27 (null guard, submitting self-transition); boundary response afterInputId=id87 releases immediately after, matching active requestId → id29. Assertions (ignored-duplicate=1, order-command=1, ui-success=1, final=id11) correct.
- **Timeout payload (id97)**: base fixture id76 satisfies id6 schema (all required fields present); binding overwrites `requestId` from emission occurrence 0. Full payload valid.
