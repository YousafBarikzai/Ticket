import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { ItsmProvider, type ItsmFeatures, type ItsmProviderProps } from '../../ItsmProvider.js';
import type { UiMessages } from '../../messages.js';
import type { LinkComponent } from '../../../types.js';

/**
 * `ItsmProvider` with test doubles for everything an application injects:
 * a plain `<a>` for its `Link`, a router of spies, and fixed hook references.
 */

export const TestLink: LinkComponent = ({ prefetch, replace, scroll, ...anchor }) => {
  void [prefetch, replace, scroll];
  return <a {...anchor} />;
};

export function testRouter(): ItsmProviderProps['router'] {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
}

const staticPathname = (): string => '/tickets';
const staticSearchParams = (): URLSearchParams => new URLSearchParams();

export interface TestProviderProps {
  readonly app?: ItsmProviderProps['app'];
  readonly features?: ItsmFeatures;
  readonly messages?: Partial<UiMessages>;
  readonly router?: ItsmProviderProps['router'];
  readonly usePathname?: () => string;
  readonly useSearchParams?: () => URLSearchParams;
  readonly locale?: string;
  readonly timeZone?: string;
  readonly storageScope?: string;
  readonly children: ReactNode;
}

export function TestProvider({
  app = 'admin',
  features,
  messages,
  router,
  usePathname = staticPathname,
  useSearchParams = staticSearchParams,
  locale = 'en-GB',
  timeZone = 'Europe/London',
  storageScope,
  children,
}: TestProviderProps): ReactElement {
  return (
    <ItsmProvider
      app={app}
      Link={TestLink}
      router={router ?? testRouter()}
      usePathname={usePathname}
      useSearchParams={useSearchParams}
      locale={locale}
      timeZone={timeZone}
      {...(features ? { features } : {})}
      {...(messages ? { messages } : {})}
      {...(storageScope ? { storageScope } : {})}
    >
      {children}
    </ItsmProvider>
  );
}
