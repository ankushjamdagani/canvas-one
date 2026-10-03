# Linked projects (D52)

A **linked-project node** stands for another project in this studio inside the current system. It is a
black box: its configuration is fixed and read-only, its identity (title, description, team) is read live
from the linked project, and it can be opened.

## Decisions (user, 2026-10-03)

- Target is another project in this studio, not an external URL.
- It simulates as a black box with ports (a fixed service), not as a diagram-only part.
- Description and team are read live from the linked project, so projects gain `description` and `team`.

## Model

- `Element.linkedProjectId?: Id`. Present only on linked-project nodes; omitted otherwise, so existing
  snapshot hashes do not change. A reference by id, never a copy of the other project's content.
- `visualKind: 'linked-project'` (added to `VISUAL_KINDS`). Catalog entry `linked-project`, group `Other`
  (no stripe), one `call` in port, behavior `resource` of type `processor` with the fixed defaults below.
  The behavior is not editable. The entry is hidden from the Standard Library list and the dock picker;
  `placeEntry` accepts it only with a `link`.
- The link never enters the run manifest (`manifest.ts` strips it): runs depend on the black-box behavior
  only, so editing or deleting the linked project cannot change a run's identity.
- Dangling links (linked project deleted, or a bundle imported where the id does not exist) are valid. The
  node shows "Project unavailable" and Open is disabled. Self-links are rejected at placement.
- Cycles (A links B, B links A) are allowed: a link is a reference, never traversed by the runner.

## Fixed black-box behavior

Same shape as the catalog `service` processor defaults (`BASE_RESOURCE_DEFAULTS`): pool-sized concurrency, 10 ms
service time, no failure injection. These are assumptions, shown as such in the entry card ("models" /
"doesNotModel": it does not model the other project's real behavior or latency).

## Project details

- `ProjectRecord.description: string` (0–500 code points) and `team: string` (0–60). Absent on old rows and
  read as `''`.
- New command `project.update-details` (`{ description, team }`, envelope and receipt rules of
  `project.rename`). It changes the project record only, not any snapshot, branch or document.
- Edited in a Project settings dialog from the project menu. Not part of the portable bundle (v9 unchanged);
  an imported project starts with empty details.

## UI

- Library: a "Projects" tab listing the other projects (title, team, description) with a Link button.
  Placing one mints a fresh element with `linkedProjectId`.
- Node: shows the live title, a LINKED badge with team, a two-line description and Open project (guarded
  navigation to `/project/:id`); caption "black box · fixed". The inspector shows read-only fields only
  (project, id, behavior) and the LINKED PROJECT tag.
- Deleting the node deletes only the reference.

## Verification

Unit: validate accepts/rejects `linkedProjectId`; manifest strips it; placement planner; command
idempotency; projection. E2E: link, open, rename the target and see the node update, delete the target and
see "unavailable".
