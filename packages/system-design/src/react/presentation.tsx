import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';
import { SystemDesignNodeCard, type SystemDesignNodeCardProps } from './NodeCard.js';

export type SystemDesignPresentation = {
  readonly nodeRenderer?: ComponentType<SystemDesignNodeCardProps>;
  readonly componentRenderers?: Readonly<Record<string, ComponentType<SystemDesignNodeCardProps>>>;
};

const PresentationContext = createContext<SystemDesignPresentation>({});

/** Overrides are scoped to this host instance, and do not alter semantic documents. */
export function SystemDesignPresentationProvider({ value, children }: {
  readonly value: SystemDesignPresentation;
  readonly children?: ReactNode;
}) {
  return createElement(PresentationContext.Provider, { value }, children);
}

function MissingComponent(props: SystemDesignNodeCardProps) {
  return createElement('div', {className: 'node-card', 'data-testid': 'missing-component-renderer'},
    props.targetHandle, `Missing renderer: ${props.element.component?.type}`, props.sourceHandle);
}
export function useSystemDesignNodeRenderer(componentType?: string): ComponentType<SystemDesignNodeCardProps> {
  const presentation = useContext(PresentationContext);
  return componentType ? presentation.componentRenderers?.[componentType] ?? MissingComponent : presentation.nodeRenderer ?? SystemDesignNodeCard;
}
