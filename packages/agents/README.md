# @canvas-one/agents

Headless reviewable proposal queue, bounded context and host-supplied model provider contracts. Hosts supply authored document projection, semantic validation, reviewer authorization and one atomic apply operation that produces one undo step. Requests contain operation identity, actor, project/branch scope and expected revision. Duplicate identities are idempotent; changed payloads are rejected. Previews remain outside authored content, stale requests require regeneration, and rejected proposals never call the host transaction.

Model clients and credentials stay in host adapters outside authored documents. This package does not execute untrusted plugin code or grant direct editing.

An optional `preparePreview` host port enables `controller.preview(operationId)`. It
returns a detached candidate only for a pending proposal at its original scope and
revision. Hosts choose the visual interface; preview projection never dispatches a
transaction. The complete app renders an escaped diagram image before acceptance.
`submitPlanned` preserves generated identities across semantic-request retries.
