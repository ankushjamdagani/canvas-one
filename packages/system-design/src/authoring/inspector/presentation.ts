import { fieldsForConnection, fieldsForElement } from './fields.js';
import type { FieldSpec, InspectorFieldFactory } from './types.js';

export type FieldPresentation = {
  readonly label?: string; readonly group?: string; readonly unit?: string; readonly note?: string;
  readonly optionLabels?: Readonly<Record<string, string>>;
};
export type FieldPresentationOverrides = Readonly<Record<string, FieldPresentation>>;

/** Metadata only: overrides never replace parsers, allowed values or semantic record writes. */
export function overrideFieldPresentation<T>(fields: readonly FieldSpec<T>[], overrides: FieldPresentationOverrides): readonly FieldSpec<T>[] {
  return fields.map((field) => {
    const custom = overrides[field.id]; if (!custom) return field;
    return Object.freeze({ ...field,
      ...(custom.label !== undefined ? { label: custom.label } : {}),
      ...(custom.group !== undefined ? { group: custom.group } : {}),
      ...(custom.unit !== undefined ? { unit: custom.unit } : {}),
      ...(custom.note !== undefined ? { note: custom.note } : {}),
      ...(field.options && custom.optionLabels ? { options: field.options.map((option) => Object.freeze({ ...option, label: custom.optionLabels![option.value] ?? option.label })) } : {}),
    });
  });
}

export function createInspectorFieldFactory(overrides: { readonly element?: FieldPresentationOverrides; readonly connection?: FieldPresentationOverrides } = {}): InspectorFieldFactory {
  return {
    element: (element) => overrideFieldPresentation(fieldsForElement(element), overrides.element ?? {}),
    connection: (connection, document) => overrideFieldPresentation(fieldsForConnection(connection, document), overrides.connection ?? {}),
  };
}
