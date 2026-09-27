/**
 * ScenariosPreview: standalone visual harness (RV-05c).
 *
 * Same purpose as src/features/library/LibraryPreview.tsx: renders this module's
 * components end-to-end against an in-memory mock document and an in-memory fake
 * session (no persistence), for lead verification and screenshot mounting, without
 * touching any file outside src/features/scenarios/**.
 */

import * as React from 'react';
import type { Id, Scenario } from '../../domain/studio/model';
import type { AuthoredResult, RecordChange } from '../../persistence/studio/types';
import { buildMockDocument, makeCounterMintId } from './mockDocument';
import { ScenarioSwitcher, type ScenarioSwitcherEntry } from './ScenarioSwitcher';
import { NewScenarioDialog, type CopySourceOption } from './NewScenarioDialog';
import { DeleteScenarioDialog } from './DeleteScenarioDialog';
import { ScenarioEditor } from './ScenarioEditor';
import {
  applyScenarioDraft,
  changeScenarioDraft,
  deleteScenario,
  openScenarioDraft,
} from './draft';
import { deriveScenarioStatus } from '../runs/scenarioStatus';
import { checkReadiness } from '../../domain/studio/readiness';
import type { ScenarioDraftHandle, ScenarioDraftTarget } from './types';

const draftMintId = makeCounterMintId(0xcafe0000);
const randomSource = () => 0.5;

export function ScenariosPreview() {
  const [document, setDocument] = React.useState(() => buildMockDocument());
  const [workingRevision, setWorkingRevision] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<Id | null>(null);
  const [editorTarget, setEditorTarget] = React.useState<ScenarioDraftTarget | null>(null);
  const [draftHandle, setDraftHandle] = React.useState<ScenarioDraftHandle | null>(null);
  const [newDialog, setNewDialog] = React.useState<{ open: boolean; initialCopySourceId: Id | null }>({
    open: false,
    initialCopySourceId: null,
  });
  const [deleteTarget, setDeleteTarget] = React.useState<Scenario | null>(null);

  // In-memory fake session -- mirrors ScenarioDraftSession, never touching real
  // persistence (src/features/session/**).
  const session = React.useMemo(
    () => ({
      getState: () => ({ workingRevision, document }),
      apply: async (changes: readonly RecordChange[], _label: string): Promise<AuthoredResult> => {
        void _label;
        let next = document;
        for (const change of changes) {
          if (change.kind === 'insert' && change.value.recordKind === 'scenario') {
            const record = change.value.record;
            next = { ...next, scenarios: [...next.scenarios, record] };
          } else if (change.kind === 'replace' && change.value.recordKind === 'scenario') {
            const record = change.value.record;
            next = {
              ...next,
              scenarios: next.scenarios.map((s) => (s.id === record.id ? record : s)),
            };
          } else if (change.kind === 'remove' && change.recordKind === 'scenario') {
            next = { ...next, scenarios: next.scenarios.filter((s) => s.id !== change.id) };
          }
        }
        setDocument(next);
        setWorkingRevision((r) => r + 1);
        return { status: 'applied', operationId: draftMintId(), projectRevision: 1, branchRevision: workingRevision + 1, changedIds: [], undo: null, value: { kind: 'none' } };
      },
    }),
    [document, workingRevision],
  );

  const entries: readonly ScenarioSwitcherEntry[] = document.scenarios.map((scenario) => {
    const readiness = checkReadiness(document, scenario.id);
    const status = deriveScenarioStatus(
      scenario.id,
      readiness.ready ? 'preview-fingerprint' : null,
      [],
      readiness.ready ? readiness.closure.includedElementIds : [],
      readiness.ready ? null : readiness.issues,
    );
    return { id: scenario.id, label: scenario.label, mode: scenario.mode, status };
  });

  const copySources: readonly CopySourceOption[] = document.scenarios.map((s) => ({
    scenarioId: s.id,
    label: s.label,
    mode: s.mode,
  }));

  const openEditor = (target: ScenarioDraftTarget) => {
    setEditorTarget(target);
    setDraftHandle(
      openScenarioDraft({
        draftId: draftMintId(),
        target,
        document,
        baseWorkingRevision: workingRevision,
        mintId: draftMintId,
        randomSource,
      }),
    );
  };

  const closeEditor = () => {
    setEditorTarget(null);
    setDraftHandle(null);
  };

  return (
    <div className="p-8 space-y-8 bg-[#F9FAF8] min-h-screen text-[#16201D] font-sans">
      <div className="max-w-6xl mx-auto space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">System Studio Scenarios Preview (RV-05c)</h1>
        <p className="text-sm text-[#626D68]">
          ScenarioSwitcher, NewScenarioDialog, ScenarioEditor (timed + logical), DeleteScenarioDialog -- all
          self-contained, against an in-memory mock document and fake session.
        </p>
      </div>

      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <ScenarioSwitcher
          scenarios={entries}
          selectedId={selectedId}
          runPhase="idle"
          onSelect={setSelectedId}
          onRun={() => {}}
          onRunAll={() => {}}
          onNew={() => setNewDialog({ open: true, initialCopySourceId: null })}
          onDuplicate={(id) => setNewDialog({ open: true, initialCopySourceId: id })}
          onEdit={(id) => openEditor({ kind: 'edit', scenarioId: id })}
          onRename={(id) => openEditor({ kind: 'edit', scenarioId: id })}
          onDelete={(id) => setDeleteTarget(document.scenarios.find((s) => s.id === id) ?? null)}
        />
      </div>

      {draftHandle && (
        <div className="max-w-6xl mx-auto">
          <div className="w-[360px] h-[720px] border border-[#E7E3DB] rounded-lg overflow-hidden shadow-sm bg-white">
            <ScenarioEditor
              document={document}
              handle={draftHandle}
              mintId={draftMintId}
              onChange={(patch) => setDraftHandle((h) => (h ? changeScenarioDraft(h, document, patch) : h))}
              onApply={() => {
                if (!draftHandle) return;
                void applyScenarioDraft(draftHandle, session).then((next) => {
                  setDraftHandle(next);
                  if (next.status === 'clean') {
                    closeEditor();
                  }
                });
              }}
              onCancel={closeEditor}
            />
          </div>
        </div>
      )}

      <NewScenarioDialog
        open={newDialog.open}
        onOpenChange={(open) => setNewDialog((d) => ({ ...d, open }))}
        copySources={copySources}
        initialCopySourceId={newDialog.initialCopySourceId}
        onCreate={({ mode, from, label }) => {
          setNewDialog({ open: false, initialCopySourceId: null });
          openEditor({ kind: 'new', mode, from, label });
        }}
      />

      {deleteTarget && (
        <DeleteScenarioDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          scenarioLabel={deleteTarget.label}
          remainingCount={Math.max(0, document.scenarios.length - 1)}
          onConfirm={() => {
            void deleteScenario(deleteTarget.id, deleteTarget.label, session).then(() => {
              setDeleteTarget(null);
              if (selectedId === deleteTarget.id) setSelectedId(null);
            });
          }}
        />
      )}
    </div>
  );
}
