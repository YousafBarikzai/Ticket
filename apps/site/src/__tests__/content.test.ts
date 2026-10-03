import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS, isServiceDeskRoutePending } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_PERSONAS, isDemoPersonaKey } from '@itsm/contracts/demo';
import { VENDOR } from '@itsm/contracts/marketing';
import { isIconName } from '@itsm/ui/icons';
import * as content from '../landing/content.js';
import { SHOTS } from '../landing/shots.config.js';
import { SHOT_MANIFEST } from '../landing/shots/manifest.js';

/**
 * The landing's copy as data (SPEC v3 §6.2, §6.6; A5 §11.6 H4, H5, H9, H10;
 * A5 §13.1 "content").
 */

const { CARDS, EXPLORE, FOOTER, HEADER, HERO, HOW, PREVIEW, SHOT_ALT, SPOTLIGHTS, landingCopy } = content;

/** The module's code, comments removed: a doc comment may quote an example; the copy may not type one. */
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'landing', 'content.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('the fictional company is said where a prospect reads it (H5)', () => {
  it('in the hero, the "What you can explore" introduction, the footer and the caption under the preview', () => {
    expect(HERO.meta.map((line) => line.text)).toContain('The demo uses a fictional company and fictional people.');
    expect(EXPLORE.sub).toContain(`${DEMO_COMPANY.name}, a fictional company`);
    expect(FOOTER.fineprint[0]).toBe(`${DEMO_COMPANY.name} and everyone in the demo are fictional. Any resemblance to real people or organisations is coincidental.`);
    expect(PREVIEW.caption).toBe('Illustrative sample data, not results from a customer.');
  });

  it('carries the trademark note and the vendor line exactly (H8, H10)', () => {
    expect(FOOTER.fineprint[1]).toMatch(/belong to their owners\. Their use does not imply any affiliation with or endorsement by them\.$/);
    expect(FOOTER.fineprint[2]).toBe(`${VENDOR.line}.`);
    expect(VENDOR.line).toBe('Powered by VNE Technologies');
  });
});

describe('British English (H9)', () => {
  it('has none of the US spellings the rule lists', () => {
    const banned = /\b(color|colors|organization|organizations|center|centers|canceled|catalog|analyze|analyzed|prioritize|prioritized|license)\b/i;
    expect(landingCopy().filter((line) => banned.test(line))).toEqual([]);
  });
});

describe('names come from the tables, never typed', () => {
  it('spells no persona name or title, company or vendor in the source', () => {
    for (const persona of DEMO_PERSONAS) {
      expect(SOURCE).not.toContain(persona.name);
      expect(SOURCE).not.toContain(persona.title);
    }
    expect(SOURCE).not.toContain(DEMO_COMPANY.name);
    expect(SOURCE).not.toContain(VENDOR.line);
  });

  it('says the copy register’s hero strings (X-M1, §6.6)', () => {
    expect(HERO.primary).toBe('Explore as an agent');
    expect(HERO.personaLine).toBe("You'll be Alex Morgan, Service Desk team lead");
    expect(HERO.or).toBe('or explore as');
    expect(DEMO_PERSONAS.filter((persona) => persona.key !== 'agent').map(content.nameAndTitle)).toEqual(['Emma Clarke, Finance Manager', 'Jordan Lee, IT Service Manager']);
    expect(HEADER.features).toBe('Features');
  });
});

describe('spotlights and cards', () => {
  const items = [...SPOTLIGHTS, ...CARDS];

  it('are four spotlights and six cards, each with a real persona, a real icon and a shot the shot list knows', () => {
    expect(SPOTLIGHTS.map((spot) => spot.id)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(CARDS.map((card) => card.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    const shotIds = new Set(SHOTS.map((shot) => shot.id));
    for (const item of items) {
      expect(isDemoPersonaKey(item.tryIt.persona), item.id).toBe(true);
      expect(isIconName(item.icon), item.id).toBe(true);
      expect(shotIds.has(item.shot), item.id).toBe(true);
    }
    // Each shot is shown once, and the shot list names the persona the "Try it" uses.
    expect(items.map((item) => item.shot).sort()).toEqual([...shotIds].sort());
    for (const item of items) expect(SHOTS.find((shot) => shot.id === item.shot)?.persona, item.id).toBe(item.tryIt.persona);
  });

  it('keeps titles and bodies to their lengths, and every point and step is a real icon', () => {
    for (const spot of SPOTLIGHTS) {
      expect(spot.title.length, spot.id).toBeLessThanOrEqual(48);
      expect(spot.points).toHaveLength(3);
    }
    for (const card of CARDS) expect(card.body.length, card.id).toBeLessThanOrEqual(220);
    for (const step of HOW.steps) expect(isIconName(step.icon), step.title).toBe(true);
    for (const line of [...HERO.meta, ...HERO.metaOff]) expect(isIconName(line.icon)).toBe(true);
    expect(HOW.steps).toHaveLength(5);
  });

  it('use the amended copy: "My work", the shared-drive request that lands in Unassigned, the service-health console (X-m7, X-B2)', () => {
    expect(SPOTLIGHTS[0]!.points[0]).toContain('My work');
    expect(SPOTLIGHTS[0]!.points.join(' ')).not.toMatch(/\bMine\b/);
    expect(SPOTLIGHTS[2]!.tryIt.text).toBe('Request “SharePoint or shared-drive access”, then switch to the Service Desk: it is first in Unassigned.');
    expect(CARDS[5]!.body).toContain('opens on a service-health summary and what needs attention');
    expect(CARDS[5]!.body).not.toContain('briefing');
  });

  it('name a pending Service Desk route only behind `needs`, so the page drops that "Try it" until it ships (H4)', () => {
    for (const item of items) {
      if (item.tryIt.needs) expect(item.tryIt.needs.startsWith('/'), item.id).toBe(true);
    }
    // The ones that need nothing are always shown in the demo.
    expect(items.filter((item) => item.tryIt.needs && !isServiceDeskRoutePending(item.tryIt.needs)).length + items.filter((item) => !item.tryIt.needs).length).toBeGreaterThan(0);
    expect(SPOTLIGHTS[3]!.tryIt.needs).toBe('/major-incidents');
    expect(CARDS[0]!.tryIt.needs).toBe('/board');
  });
});

describe('the screenshots', () => {
  it('have an alt text for every shot, each saying "in the demo" and counting nothing', () => {
    for (const shot of SHOTS) {
      expect(SHOT_ALT[shot.id], shot.id).toMatch(/in the demo/);
      expect(SHOT_ALT[shot.id], shot.id).not.toMatch(/\d/);
    }
  });

  it('start with an empty manifest: every shot draws its server-rendered stand-in until the final wave (X-M9)', () => {
    expect(Object.keys(SHOT_MANIFEST)).toEqual([]);
    for (const shot of SHOTS) expect(Object.keys(AREAS)).toContain(shot.area);
  });
});
