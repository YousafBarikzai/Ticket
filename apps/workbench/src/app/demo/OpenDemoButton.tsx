'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@itsm/ui';

/** How long the form gets to submit itself before the button owns up (A3 §6.2). */
export const TAKING_A_WHILE_MS = 3_000;

/**
 * The `/demo` entry form's button while the form submits itself (§4.6.2):
 * "Open the demo", which after three seconds reads "Taking a while? Open the
 * demo" — said plainly, so a visitor whose tab was slow to submit, or whose
 * browser held the submission back, knows the button is the way on. The
 * page works without it: the server renders the first label and the form
 * posts when pressed.
 */
export function OpenDemoButton({ fullWidth = true }: { readonly fullWidth?: boolean }): ReactNode {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), TAKING_A_WHILE_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Button type="submit" variant="primary" size="lg" fullWidth={fullWidth}>
      {late ? 'Taking a while? Open the demo' : 'Open the demo'}
    </Button>
  );
}
