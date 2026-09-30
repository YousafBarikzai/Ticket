import { redirect } from 'next/navigation';

/** The workbench opens on the inbox; there is no home page worth the click (SPEC §5.3). */
export default function Home(): never {
  redirect('/inbox');
}
