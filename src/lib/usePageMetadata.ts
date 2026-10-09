import { useEffect } from 'react';
import type { Route } from './router';

/** Keep standalone document metadata in sync with client-side route changes. */
export function usePageMetadata(
  kind: Route['kind'],
  { enabled, siteOrigin, basePath }: { enabled: boolean; siteOrigin?: string; basePath?: string },
) {
  useEffect(() => {
    if (!enabled) return;
    const publicPage = kind === 'home' || kind === 'brand';
    const description =
      kind === 'brand'
        ? 'Canvas One brand guidelines, visual language and interface foundations.'
        : 'Beyond chat: The shared canvas for engineers and AI to think, architect, and review systems together.';
    document.title =
      kind === 'home'
        ? 'Canvas One — The shared canvas for engineers and AI'
        : `${kind === 'brand' ? 'Brand' : kind === 'projects' ? 'Projects' : 'Workspace'} | Canvas One`;
    for (const [name, content] of [
      ['robots', publicPage ? 'index, follow' : 'noindex, nofollow'],
      ['description', description],
    ]) {
      let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.name = name;
        document.head.append(element);
      }
      element.content = content;
    }
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (siteOrigin && publicPage) {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = `${new URL(siteOrigin).origin}${basePath ?? ''}${kind === 'brand' ? '/brand' : '/'}`;
    } else canonical?.remove();
    for (const property of ['og:title', 'og:description']) {
      const element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (element)
        element.content = property === 'og:title' ? document.title : description;
    }
  }, [kind, enabled, siteOrigin, basePath]);
}
