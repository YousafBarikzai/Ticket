import type { AreaId } from '@itsm/contracts/areas';
import type { DemoPersonaKey } from '@itsm/contracts/demo';

/**
 * The landing's screenshots: what to capture, as whom, and how each is drawn
 * until it exists (SPEC v3 §6.2 "Screenshot pipeline"; A5 §5.1, §5.4; X-M9).
 *
 * The final wave's capture script (`infra/scripts/capture-site-shots.ts`)
 * reads this list, signs in to the demo as each persona through the site's own
 * chooser, follows `where`, does `before`, and writes the pictures and
 * `shots/manifest.ts`. Until then the manifest is empty and `Shot` draws the
 * entry's `preview` — a small server-rendered picture of that screen with a
 * "Sample data" chip, in the final aspect ratio, so the layout never moves
 * and nothing on the page says "coming soon".
 *
 * Every shot is light theme, 1440 × 900 at device scale 2, with the demo bar
 * hidden: the product a customer buys has no demo bar.
 */

export type ShotId =
  | 'desk-inbox'
  | 'sla-overview'
  | 'portal-home'
  | 'war-room'
  | 'board'
  | 'insights'
  | 'knowledge'
  | 'ai-triage'
  | 'rules'
  | 'command-centre';

/** How the stand-in draws the screen: a KPI row and a trend, rows of records, columns, or tiles. */
export type ShotPreviewKind = 'overview' | 'list' | 'board' | 'tiles';

export interface ShotSpec {
  readonly id: ShotId;
  /** The spotlight (S1–S4) or card (C1–C6) that shows it. */
  readonly usedBy: string;
  readonly persona: DemoPersonaKey;
  /** The area the screen belongs to: its mark on the stand-in. */
  readonly area: AreaId;
  /** Navigation by role and label, for the capture script. */
  readonly where: string;
  /** What to do before the picture is taken, if anything. */
  readonly before?: string;
  /** The stand-in until the picture exists. */
  readonly preview: { readonly kind: ShotPreviewKind; readonly title: string };
}

export const SHOTS: readonly ShotSpec[] = Object.freeze([
  {
    id: 'desk-inbox',
    usedBy: 'S1',
    persona: 'agent',
    area: 'workbench',
    where: 'Service Desk → My work → the ticket titled "Outlook keeps asking for my password"',
    before: 'the ticket open in the reading pane',
    preview: { kind: 'list', title: 'My work' },
  },
  {
    id: 'sla-overview',
    usedBy: 'S2',
    persona: 'agent',
    area: 'workbench',
    where: 'Service Desk → Overview',
    before: 'period 30 days',
    preview: { kind: 'overview', title: 'Overview' },
  },
  { id: 'portal-home', usedBy: 'S3', persona: 'employee', area: 'portal', where: 'Help Portal → Home', preview: { kind: 'tiles', title: 'How can we help?' } },
  {
    id: 'war-room',
    usedBy: 'S4',
    persona: 'agent',
    area: 'workbench',
    where: 'Service Desk → Major incidents → "VPN sign-in failures for remote staff"',
    preview: { kind: 'list', title: 'VPN sign-in failures for remote staff' },
  },
  { id: 'board', usedBy: 'C1', persona: 'agent', area: 'workbench', where: 'Service Desk → Board', preview: { kind: 'board', title: 'Board' } },
  {
    id: 'insights',
    usedBy: 'C2',
    persona: 'admin',
    area: 'admin',
    where: 'Administration → Insights',
    before: 'period 30 days',
    preview: { kind: 'overview', title: 'Insights' },
  },
  {
    id: 'knowledge',
    usedBy: 'C3',
    persona: 'employee',
    area: 'portal',
    where: 'Help Portal → Knowledge, search "VPN"',
    preview: { kind: 'list', title: 'Knowledge' },
  },
  {
    id: 'ai-triage',
    usedBy: 'C4',
    persona: 'agent',
    area: 'workbench',
    where: 'Service Desk → the ticket titled "Laptop won’t wake from sleep when docked"',
    before: 'the suggested triage visible',
    preview: { kind: 'list', title: 'Suggested triage' },
  },
  {
    id: 'rules',
    usedBy: 'C5',
    persona: 'admin',
    area: 'admin',
    where: 'Administration → Rules → the first published rule → Try it',
    before: 'the Try it panel open with a result',
    preview: { kind: 'list', title: 'Rules' },
  },
  {
    id: 'command-centre',
    usedBy: 'C6',
    persona: 'admin',
    area: 'admin',
    where: 'Administration → Command centre',
    preview: { kind: 'overview', title: 'Command centre' },
  },
] satisfies ShotSpec[]);

export function shotSpec(id: ShotId): ShotSpec {
  const found = SHOTS.find((shot) => shot.id === id);
  if (!found) throw new RangeError(`no shot "${id}"`);
  return found;
}

/** One encoded width of a picture, as the capture script writes it (a hashed static import). */
export interface ShotSource {
  readonly src: string;
  readonly width: number;
}

/** A captured picture: AVIF and WebP at three widths, and the size it was taken at (so the layout reserves it). */
export interface ShotAsset {
  readonly avif: readonly ShotSource[];
  readonly webp: readonly ShotSource[];
  readonly width: number;
  readonly height: number;
}
