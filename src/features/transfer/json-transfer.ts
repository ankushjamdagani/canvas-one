/**
 * Portable JSON export and import flows. Export is deterministic (byte-identical for the same project);
 * import checks the file size before reading it and rejects unsupported or corrupted bundles.
 */

import { TRANSFER_LIMITS, validatePortableBundle } from '../../persistence/studio/bundle-validate';
import { FileTokenRegistry } from '../../persistence/studio/file-tokens';
import type { ProjectImportCommand } from '../../persistence/studio/types';
import { jsonFileName } from './filename';
import { JSON_EXPORT_LIMITATIONS } from './limitations';
import type {
  ExportProjectJsonParams,
  ExportProjectJsonResult,
  ImportProjectJsonParams,
  ImportProjectJsonResult,
  RepositoryWithFileTokens,
} from './types';
import { createIssue } from '../../domain/studio/issue';

function hasFileTokens(
  repo: ImportProjectJsonParams['repository'],
): repo is RepositoryWithFileTokens {
  return 'fileTokens' in repo && repo.fileTokens instanceof FileTokenRegistry;
}

/**
 * Exports a project as a portable v9 JSON bundle.
 * Uses repository.exportProject without re-serialization (canonical bytes as returned).
 * MintId is required (no default random UUID).
 */
export async function exportProjectJson(
  params: ExportProjectJsonParams,
): Promise<ExportProjectJsonResult> {
  const { repository, projectId, expectedProjectRevision, mintId } = params;

  if (typeof mintId !== 'function') {
    return {
      ok: false,
      kind: 'invalid',
      message: 'mintId function is required for exportProjectJson',
      issues: [createIssue('missing-property', 'mintId function is required', ['mintId'])],
    };
  }

  const res = await repository.exportProject({
    projectId,
    expectedProjectRevision,
  });

  if (res.status === 'stale') {
    return {
      ok: false,
      kind: 'stale',
      message: `Project revision ${expectedProjectRevision} is stale`,
    };
  }

  if (res.status === 'missing') {
    return {
      ok: false,
      kind: 'not-found',
      message: `Project '${projectId}' was not found`,
    };
  }

  if (res.status === 'invalid') {
    return {
      ok: false,
      kind: 'invalid',
      // Fallback message when repository export returns invalid status with empty issues array
      message: res.issues[0]?.message ?? 'Invalid export request',
      issues: res.issues,
    };
  }

  if (res.status === 'failed') {
    return {
      ok: false,
      kind: res.code === 'limit' ? 'limit' : 'failed',
      // Fallback message when repository export fails with empty issues array
      message: res.issues[0]?.message ?? 'Export failed',
      issues: res.issues,
    };
  }

  if (res.status !== 'done') {
    return {
      ok: false,
      kind: 'failed',
      message: 'Unexpected export outcome',
    };
  }

  // Obtain project title for sanitized filename stem
  let title: string | undefined;
  try {
    const project = await repository.loadProject(projectId);
    title = project?.title;
  } catch {
    // fallback
  }

  if (!title) {
    try {
      const text = new TextDecoder('utf-8').decode(res.bytes);
      const parsed = JSON.parse(text);
      title = parsed?.project?.title;
    } catch {
      // fallback
    }
  }

  const fileName = jsonFileName(title);
  const blob = new Blob([res.bytes as unknown as BlobPart], { type: 'application/json;charset=utf-8' });

  return {
    ok: true,
    fileName,
    blob,
    bytes: res.bytes,
    sha256: res.sha256,
    limitations: JSON_EXPORT_LIMITATIONS,
  };
}

/**
 * Imports a portable v9 JSON bundle into a fresh project namespace.
 * Checks byte cap before reading into memory, validates bundle,
 * and calls project.import with fresh IDs from mintId.
 * Never partial: all-or-nothing transaction.
 */
export async function importProjectJson(
  params: ImportProjectJsonParams,
): Promise<ImportProjectJsonResult> {
  const { repository, file, mintId, actor } = params;

  if (typeof mintId !== 'function') {
    return {
      ok: false,
      kind: 'invalid',
      message: 'mintId function is required for importProjectJson',
      issues: [createIssue('missing-property', 'mintId function is required', ['mintId'])],
    };
  }

  if (!actor || actor.kind !== 'local-human' || !actor.actorId || !actor.displayName) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'A valid local-human actor is required',
      issues: [createIssue('wrong-type', 'A valid local-human actor is required', ['actor'])],
    };
  }

  // 1. Byte cap check BEFORE reading into memory (64 MiB transfer cap)
  if (file && typeof (file as Blob).size === 'number') {
    const size = (file as Blob).size;
    if (size > TRANSFER_LIMITS.maxFileBytes) {
      const message = `File size ${size} bytes exceeds the 64 MiB (${TRANSFER_LIMITS.maxFileBytes} bytes) transfer limit`;
      return {
        ok: false,
        kind: 'too-large',
        message,
        issues: [createIssue('too-large', message)],
      };
    }
  } else if (file instanceof Uint8Array) {
    if (file.byteLength > TRANSFER_LIMITS.maxFileBytes) {
      const message = `File size ${file.byteLength} bytes exceeds the 64 MiB (${TRANSFER_LIMITS.maxFileBytes} bytes) transfer limit`;
      return {
        ok: false,
        kind: 'too-large',
        message,
        issues: [createIssue('too-large', message)],
      };
    }
  }

  // 2. Read bytes
  let bytes: Uint8Array;
  if (file instanceof Uint8Array) {
    bytes = file;
  } else if (file && typeof (file as Blob).arrayBuffer === 'function') {
    try {
      const buffer = await (file as Blob).arrayBuffer();
      bytes = new Uint8Array(buffer);
    } catch {
      return {
        ok: false,
        kind: 'invalid',
        message: 'Could not read file data',
        issues: [createIssue('wrong-type', 'Could not read file data', ['file'])],
      };
    }
  } else {
    return {
      ok: false,
      kind: 'invalid',
      message: 'file must be a File, Blob, or Uint8Array',
      issues: [createIssue('wrong-type', 'file must be a File, Blob, or Uint8Array', ['file'])],
    };
  }

  // Double check byte length
  if (bytes.byteLength > TRANSFER_LIMITS.maxFileBytes) {
    const message = `File size ${bytes.byteLength} bytes exceeds the 64 MiB (${TRANSFER_LIMITS.maxFileBytes} bytes) transfer limit`;
    return {
      ok: false,
      kind: 'too-large',
      message,
      issues: [createIssue('too-large', message)],
    };
  }

  // 3. Validate portable bundle outside of any transaction
  const validation = await validatePortableBundle(bytes);
  if (!validation.ok) {
    if (validation.kind === 'unsupported-version') {
      // Formats 7/8 say clearly "made with the old app, not supported"
      let isOldApp = false;
      try {
        const preview = new TextDecoder('utf-8').decode(bytes.slice(0, 512));
        const match = preview.match(/"version"\s*:\s*([0-9]+)/);
        if (match && (match[1] === '7' || match[1] === '8')) {
          isOldApp = true;
        }
      } catch {
        // ignore decode error
      }
      if (validation.issues.some((iss) => iss.message.includes("'7'") || iss.message.includes("'8'"))) {
        isOldApp = true;
      }

      // Fallback message when portable bundle validator reports unsupported version with empty issues
      const message = isOldApp
        ? 'File was made with the old app, not supported'
        : (validation.issues[0]?.message ?? 'Unsupported portable file version');

      return {
        ok: false,
        kind: 'unsupported-version',
        message,
        issues: isOldApp
          ? [createIssue('invalid-literal', message, ['version'])]
          : validation.issues,
      };
    }

    const tooLargeIssue = validation.issues.find((iss) => iss.code === 'too-large');
    if (tooLargeIssue) {
      return {
        ok: false,
        kind: 'too-large',
        message: tooLargeIssue.message,
        issues: validation.issues,
      };
    }

    return {
      ok: false,
      kind: 'invalid',
      // Fallback message when portable bundle validator reports invalid structure with empty issues
      message: validation.issues[0]?.message ?? 'Invalid portable bundle',
      issues: validation.issues,
    };
  }

  // 4. Resolve repository's FileTokenRegistry via explicit parameter or narrowed repository type
  let registry: FileTokenRegistry | undefined;
  if (params.fileTokens) {
    registry = params.fileTokens;
  } else if (hasFileTokens(repository)) {
    registry = repository.fileTokens;
  }

  if (!registry) {
    const message = 'FileTokenRegistry is not available for repository';
    return {
      ok: false,
      kind: 'failed',
      message,
      issues: [createIssue('missing-property', message, ['fileTokens'])],
    };
  }

  const fileToken = await registry.registerFile(bytes, mintId);

  // 5. Execute project.import command in atomic transaction
  const newProjectId = mintId();
  const operationId = mintId();

  const command: ProjectImportCommand = {
    commandId: 'project.import',
    operationId,
    actor,
    payload: {
      fileToken,
      newProjectId,
    },
  };

  const importResult = await repository.importProject(command);

  if (importResult.status === 'applied') {
    return {
      ok: true,
      projectId: newProjectId,
      result: importResult,
    };
  }

  if (importResult.status === 'failed') {
    if (importResult.code === 'quota') {
      return {
        ok: false,
        kind: 'quota',
        // Fallback message when repository import fails with quota code but empty issues
        message: importResult.issues[0]?.message ?? 'Storage quota exceeded',
        issues: importResult.issues,
      };
    }
    if (importResult.code === 'limit') {
      return {
        ok: false,
        kind: 'too-large',
        // Fallback message when repository import fails with limit code but empty issues
        message: importResult.issues[0]?.message ?? 'Storage limit exceeded',
        issues: importResult.issues,
      };
    }
    if (importResult.code === 'unsupported-version') {
      return {
        ok: false,
        kind: 'unsupported-version',
        // Fallback message when repository import fails with unsupported-version code but empty issues
        message: importResult.issues[0]?.message ?? 'Unsupported version',
        issues: importResult.issues,
      };
    }
    return {
      ok: false,
      kind: 'invalid',
      // Fallback message when repository import fails with generic error and empty issues
      message: importResult.issues[0]?.message ?? 'Import failed',
      issues: importResult.issues,
    };
  }

  if (importResult.status === 'invalid') {
    const tooLarge = importResult.issues.find((i) => (i.code as string) === 'too-large');
    if (tooLarge) {
      return {
        ok: false,
        kind: 'too-large',
        message: tooLarge.message,
        issues: importResult.issues,
      };
    }
    return {
      ok: false,
      kind: 'invalid',
      // Fallback message when repository import returns invalid status with empty issues
      message: importResult.issues[0]?.message ?? 'Invalid project bundle',
      issues: importResult.issues,
    };
  }

  return {
    ok: false,
    kind: 'invalid',
    message: 'Import failed',
    issues: [],
  };
}
