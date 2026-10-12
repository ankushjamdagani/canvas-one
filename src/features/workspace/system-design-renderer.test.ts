import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemDesignNodeCard, SystemDesignPresentationProvider, useSystemDesignNodeRenderer, type SystemDesignNodeCardProps } from '@canvas-one/system-design/react';

const props: SystemDesignNodeCardProps = {
  element: { id: 'service', label: 'Service', description: '', visualKind: 'service', ports: [],
    behavior: { kind: 'unmodeled', version: 1, reason: 'diagram' } },
  placement: { id: 'placement', width: 248, expanded: true },
};

describe('optional system-design renderer', () => {
  it('renders authored geometry and captions without an editor or simulation provider', () => {
    const html = renderToStaticMarkup(createElement(SystemDesignNodeCard, props));
    expect(html).toContain('width:248px');
    expect(html).toContain('Not simulated');
    expect(html).toContain('in: none · out: none');
    expect(html).toContain('data-placement-id="placement"');
  });
  it('composes host handles, activity and linked presentation as independent slots', () => {
    const html = renderToStaticMarkup(createElement(SystemDesignNodeCard, { ...props,
      highlighted: true, stripeColor: '#123456', layer: 'host', selected: false,
      linked: { state: 'available', title: 'Custom title', team: 'Team', description: 'Description' },
      targetHandle: createElement('span', { 'data-custom-handle': 'target' }),
      sourceHandle: createElement('span', { 'data-custom-handle': 'source' }),
      activity: createElement('aside', null, 'Host activity'), onOpenLinked: () => {},
    }));
    expect(html).toContain('data-custom-handle="target"');
    expect(html).toContain('data-custom-handle="source"');
    expect(html).toContain('Host activity');
    expect(html).toContain('Custom title');
    expect(html).toContain('ring-primary');
    expect(html).toContain('data-node-layer="host"');
  });
  it('scopes a host renderer override without changing the default for other instances', () => {
    function BoundCard() { const Renderer = useSystemDesignNodeRenderer(); return createElement(Renderer, props); }
    const custom = ({ element }: SystemDesignNodeCardProps) => createElement('article', null, `Custom ${element.label}`);
    const overridden = renderToStaticMarkup(createElement(SystemDesignPresentationProvider,
      { value: { nodeRenderer: custom } }, createElement(BoundCard)));
    expect(overridden).toBe('<article>Custom Service</article>');
    expect(renderToStaticMarkup(createElement(BoundCard))).toContain('data-placement-id="placement"');
  });
  it('selects namespaced component renderers and preserves a labeled fallback when the renderer is absent', () => {
    const customProps = {...props, element: {...props.element, component: {type: 'example/card', data: {text: 'Custom'}, extensions: {}}}};
    function Card() { const Renderer = useSystemDesignNodeRenderer('example/card'); return createElement(Renderer, customProps); }
    const renderer = ({element}: SystemDesignNodeCardProps) => createElement('article', null, element.component?.type);
    expect(renderToStaticMarkup(createElement(SystemDesignPresentationProvider, {value: {componentRenderers: {'example/card': renderer}}}, createElement(Card)))).toBe('<article>example/card</article>');
    expect(renderToStaticMarkup(createElement(Card))).toContain('Missing renderer: example/card');
  });
});
