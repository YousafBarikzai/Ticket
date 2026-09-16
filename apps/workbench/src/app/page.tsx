import { redirect } from 'next/navigation';

/** The workbench opens on the queue; there is no home page worth the click. */
export default function Home(): never {
  redirect('/queue');
}
