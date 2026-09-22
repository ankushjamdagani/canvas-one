**PASS**

Traced all five rows through the four-operation pipeline:

| row | amountMinor | validate (id9) | trim region | deduplicate orderId | group-sum |
|-----|-------------|----------------|-------------|---------------------|-----------|
| r0 orderId:a | 1000 (int) | pass | " EU "→"EU" | kept (first "a") | EU +1000 |
| r1 orderId:a | 1000 (int) | pass | "EU"→"EU" | excluded (dup "a") | — |
| r2 orderId:b | 2500 (int) | pass | "US"→"US" | kept | US +2500 |
| r3 orderId:c | "bad" (str) | **error** → error port (original row) | — | — | — |
| r4 orderId:d | 500 (int) | pass | "EU"→"EU" | kept | EU +500 |

**group-sum result** sorted by UTF-16: EU=1500, US=2500. Matches `id25` expected `[[{region:"EU",amountMinor:1500},{region:"US",amountMinor:2500}]]`. ✓

**error batch** = one nonempty batch `[{orderId:"c",region:"EU",amountMinor:"bad"}]`. Output subject wraps in outer array → `[[...]]`. Matches `id26`. ✓

**Contract checks all clear:**

- `errorSchemaId:id4` is list of scalar-union rows; r3's original `"bad"` value is a valid id4 item. ✓
- Pipeline emits success/error only when nonempty; both are nonempty here. ✓
- id9 (record, amountMinor:integer) correctly narrows from id4 items (scalar-union). ✓
- group-sum receives integer amountMinor (post-validate survivors); integer overflow check applies; 1500 and 2500 are safe integers. ✓
- Logical mode: atMs:null, completion:quiescent, empty workloads/faults, no resources. ✓
- Data input creates control invocation; no user transport roots generated; count assertions absent so no conservation issue. ✓
- Scenario eligibility: ≥1 assertion ✓, ≥1 consumed external input ✓.
- Port schemas match behavior schema IDs (id3→id4, id5→id6, id7→id4). ✓
- `scalar-union types:["integer","string"]` — number+integer coexistence rule not violated. ✓
- No outgoing calls → no boundaries needed; no state machines → no responseBindings needed. ✓

No blockers.
