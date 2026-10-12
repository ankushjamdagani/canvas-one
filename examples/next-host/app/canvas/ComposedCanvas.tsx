'use client';
import { CanvasOne, createStudioComposition } from '@canvas-one/react';
import { planCustomComponent } from '@canvas-one/system-design';
import type { SystemDesignNodeCardProps } from '@canvas-one/system-design/react';
import type { ExtensionDefinition } from '@canvas-one/whiteboard';

const extension: ExtensionDefinition = {
  manifest: {id: 'example/host', version: '1.0.0', dependencies: [], capabilities: ['components']},
  contributions: [{id: 'example/review-card', version: '1.0.0', kind: 'component', capabilities: ['validation'],
    value: {validate: (entity: {data: unknown}) => {
      const data = entity.data as {message?: unknown};
      return typeof data?.message === 'string' ? [] : [{code: 'example/invalid-message', path: ['data', 'message'],
        entityId: null, severity: 'error', message: 'Review cards need a message'}];
    }}}],
};

function ReviewCard({element, placement, selected, targetHandle, sourceHandle}: SystemDesignNodeCardProps) {
  const data = element.component?.data as {message: string};
  return <article data-testid="host-review-card" data-element-id={element.id}
    style={{width: placement.width, padding: 12, border: selected ? '2px solid #2563eb' : '1px solid #525252',
      borderRadius: 8, background: '#eff6ff', color: '#171717'}}>
    {targetHandle}<strong>{element.label}</strong><p>{data.message}</p>{sourceHandle}
  </article>;
}

const composition = createStudioComposition({
  extensions: [extension],
  systemDesignPresentation: {componentRenderers: {'example/review-card': ReviewCard}},
  createCommandContributions: ({session}) => [{
    definition: {
      metadata: {id: 'example/add-review-card', label: 'Add host review card', keywords: ['custom', 'extension'], effect: 'document'},
      validate: input => input === null ? {valid: true, value: null} : {valid: false, reason: 'This action takes no input'},
      availability: () => session.getState().document?.views.length ? {enabled: true} :
        {enabled: false, code: 'no-view', reason: 'Open a project view first'},
      execute: async () => {
        const document = session.getState().document;
        if (!document) return;
        const plan = planCustomComponent(document, {viewId: document.views[0].id,
          elementId: crypto.randomUUID(), placementId: crypto.randomUUID(), label: 'Host review card',
          component: {type: 'example/review-card', extensions: {}, data: {message: 'Host-owned UI, shared authoring history', unknown: {preserve: true}}},
          position: {x: 80, y: 80}, width: 260});
        return plan.ok ? session.apply(plan.changes, 'Add host review card') : plan;
      },
    }, palette: {input: null},
  }],
});

export function ComposedCanvas() {
  return <CanvasOne basePath="/canvas" storageNamespace="next-host-example" composition={composition} />;
}
