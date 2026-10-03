import { notFound } from 'next/navigation';

/**
 * Any address inside the console that no page answers (A7 §3.1 row 51, T6).
 *
 * Without this, a mistyped address fell through to the root `not-found.tsx`:
 * a bare status screen with no sidebar, and — worse — a different page from
 * the one `/tenants` shows a non-operator, whose platform layout answers
 * `notFound()` inside the frame. Two 404s told apart that way would say which
 * addresses exist. Here every unknown address gets the in-frame one
 * (`(console)/not-found.tsx`), with the person's own navigation beside it and
 * "Page not found" in the top bar (the frame's last route title).
 *
 * It sits beside `(admin)`, not in it, so no `loading.tsx` streams a 200
 * before the 404 is known; static routes always win over this catch-all.
 */
export default function MissingPage(): never {
  notFound();
}
