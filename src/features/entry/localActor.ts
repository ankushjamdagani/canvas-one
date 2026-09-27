/**
 * Local actor identity for entry-screen commands (RV-10b).
 *
 * project.import (commands.md, storage.md §5) requires an `Actor`, same as every
 * other authored command. `App.tsx` already mints and persists one local-human
 * actor id per browser (`localStorage['system-studio.actor-id']`) for the session
 * controller; that construction isn't reachable from here (App.tsx is outside this
 * task's allowed files, and SessionController has no public actor getter), so this
 * mirrors the identical convention -- same storage key, same actor kind and display
 * name -- rather than inventing a new one. Reading the same key returns the same id
 * `App.tsx` already created for the current browser.
 */

import type { Actor } from '../../persistence/studio/types';

const ACTOR_ID_STORAGE_KEY = 'system-studio.actor-id';

function getOrCreateActorId(): string {
  try {
    const stored = localStorage.getItem(ACTOR_ID_STORAGE_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(ACTOR_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/** Builds the local-human Actor used for entry-screen commands (project.import). */
export function getLocalHumanActor(): Actor {
  return {
    actorId: getOrCreateActorId(),
    kind: 'local-human',
    displayName: 'You',
  };
}
