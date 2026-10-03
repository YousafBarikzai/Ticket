import { redirect } from 'next/navigation';
import { AREAS } from '@itsm/contracts/areas';

/**
 * The Service Desk opens on its Overview (v3 §3.5, §7.1): `/` answers 307 to
 * the area's home, which is also where a sign-in lands (`bff.ts`) and where
 * an installed app starts (`manifest.ts`).
 */
export default function Home(): never {
  redirect(AREAS.workbench.home);
}
