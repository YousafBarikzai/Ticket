'use client';

import { useState, type ReactNode } from 'react';
import { IconButton } from '@itsm/ui';
import { useTheme } from '@itsm/ui/theme';

/**
 * A permission, metric or setting key — shown only to people who turned on
 * *Show technical keys* (X-11, X-81), with Copy. Everyone else reads the
 * name in words beside it and never meets the key.
 */
export function TechnicalKey({ value, label = 'key' }: { readonly value: string; readonly label?: string }): ReactNode {
  const { prefs } = useTheme();
  const [copied, setCopied] = useState(false);
  if (!prefs.showKeys) return null;
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <span className="app-TechnicalKey">
      <code>{value}</code>
      <IconButton label={copied ? `Copied ${label}` : `Copy ${label}`} icon={copied ? 'check' : 'copy'} size="sm" onClick={copy} />
    </span>
  );
}
