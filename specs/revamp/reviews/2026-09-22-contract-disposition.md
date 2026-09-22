# Detailed contract review disposition

Implementation hold remains. Initial four-contract draft checkpoint: 1697d42.

## First pass

- UI/transfer Claude Sonnet 4.6 review returned exit 0, REVISE, CP-1–7 and PE-1–7. Explicit command context/shortcut types, pre-transition draft guards, placement index/reset/singleton rules, enumerated reference remapping and export enums/encoding clarify all requested items in the revised drafts. These are lead corrections awaiting closure, not an unearned PASS.
- PE-1/2/3 requested individual reference enumeration; the original already required all schema-owned references to remap. Accepted enumeration as useful coverage evidence, not evidence that implemented copying had lost data (there is no implementation).
- UI report's opening claim that prior review reports were empty is inaccurate: historical P1–P4/policy reports exist. The simultaneously running core output was empty. Its final “four Severity 2” count lists six items. Raw report remains unchanged; neither editorial error changes substantive corrections.
- Core attempt timed out at 300 seconds, exit 124, empty output. Its process group was terminated and waited for; no findings or acceptance inferred. Retry is split into bounded schema/runner and storage reviews. Prompts, actual state and input hashes are preserved.

## Lead source/contract checks

- src/simulation/open/kernel.ts scheduleNextArrival rejects times strictly greater than duration; arrival at horizon is included. Corrected new draft's erroneous strictly-before phrase.
- Added record/list Value constructors, explicit machine call-response bindings and timer/reply effects, pipeline/resource entry ports, causal invocation rules and closed result records. These are new proposed grammar details requiring core review, not presumed executable behavior.
- Added schema dependency manifest field, source/main cleanliness and revision requirements, full authored-export size invariant and recovery operations at receipt cap.
- Added [rollout protocol](../work/contract-rollout.md): RV-16a repository base precedes durable versioning acceptance; pure independent lanes remain possible. No Gemini preflight or implementation is claimed.

## Pending evidence

Focused schema/runner, storage and UI closure review; concrete S01–S05 serialized fixture sizing; remaining detailed grammar findings if raised. Runtime performance, browser panel behavior and parser/spreadsheet tests are future implementation acceptance checks. Conservative specified ceilings are not measured runtime guarantees. No contract is marked accepted solely because this disposition lists intended fixes.
