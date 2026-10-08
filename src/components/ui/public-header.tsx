import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { APP_VERSION_LABEL } from '@/lib/appVersion';
import { ThemePopover } from '@/lib/theme/ThemePopover';
import { BrandMark } from './brand-mark';
import { Button } from './button';
import { Reveal } from './reveal';
import { cn } from '@/lib/utils';

/** Shared chrome for public pages; projects replace the beta action with their owner. */
export function PublicHeader({ page, collaborators, owner, className }: {
  page: 'landing' | 'brand' | 'projects';
  collaborators?: ReactNode;
  owner?: ReactNode;
  className?: string;
}) {
  return <header className={cn('public-header', className)}>
    <Reveal as="a" kind="chrome" index={0} href="/" className="public-brand">
      <BrandMark /><span className="brand-wordmark">Canvas One</span>
    </Reveal>
    <Reveal as="span" kind="chrome" index={1} className="public-version">{APP_VERSION_LABEL}</Reveal>
    <Reveal as="nav" kind="chrome" index={2} aria-label="Main navigation">
      {collaborators}
      <Button asChild variant="ghost" className="public-brand-link"><a href="/brand" aria-current={page === 'brand' ? 'page' : undefined}>Brand</a></Button>
      {page !== 'projects' && <Button asChild variant="ghost" className="public-github"><a href="https://github.com/ankushjamdagani/canvas-one" target="_blank" rel="noreferrer">GitHub</a></Button>}
      {page !== 'projects' && <Button asChild variant="outline" className="public-header-action"><a href="/projects">Try Beta <ArrowRight /></a></Button>}
      {page === 'projects' && owner}
      <ThemePopover />
    </Reveal>
  </header>;
}
