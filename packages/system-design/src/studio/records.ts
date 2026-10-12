/** System-specific records instantiated over the whiteboard's generic change algebra. */
import type {
  EditableRecord as BoardEditableRecord,
  RecordChange as BoardRecordChange,
  RecordKind as BoardRecordKind,
} from '@canvas-one/whiteboard';
import type { Connection, Element, Fixture, PayloadSchema, Refinement, Relation, Scenario, View } from './model.js';

export const RECORD_KINDS = [
  'element', 'connection', 'relation', 'schema', 'fixture', 'refinement', 'scenario', 'view',
] as const;

export type SystemRecordMap = {
  element: Element;
  connection: Connection;
  relation: Relation;
  schema: PayloadSchema;
  fixture: Fixture;
  refinement: Refinement;
  scenario: Scenario;
  view: View;
};
export type RecordKind = BoardRecordKind<SystemRecordMap>;
export type EditableRecord = BoardEditableRecord<SystemRecordMap>;
export type RecordChange = BoardRecordChange<SystemRecordMap>;
