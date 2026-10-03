import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStateSchema, prioritySchema, statusCategorySchema, ticketTypeSchema } from '@itsm/contracts';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { chartToneOutline, chartToneVar } from '../../charts/tone.js';
import type { ChartTone } from '../../charts/types.js';
import { toneIcon, toneIntent, toneRules, tones } from '../../feedback/tone.js';
import { isIconName } from '../../icons/registry.js';
import { unknownVariables } from '../../styles/css.js';
import type { Tone } from '../../types.js';
import {
  APPROVAL_STATE_LOOK,
  approvalStateLook,
  COMPONENT_STATE_LOOK,
  MAJOR_INCIDENT_LOOK,
  PRIORITY_LOOK,
  priorityLook,
  PROBLEM_STATE_LOOK,
  SLA_STATE_LOOK,
  STATUS_CATEGORY_LOOK,
  TICKET_STATE_LOOK,
  ticketStateLook,
  ticketTypeLook,
  TYPE_LOOK,
  type StateLook,
} from '../ticket-states.js';
import { statusIcon, toneVariables } from '../tone.js';

/*
 * The state maps (D5, v3 §2.4) and the guard rules that keep the palette
 * honest. The maps are data, so most of this file is a table checked against
 * the specification's table — and then the rules no table states but every
 * page relies on: amber is SLA risk and nothing else, the control blue is
 * never a state, every state has words and a shape, and the keys are exactly
 * the ones the API and the modules produce.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(SRC, '..', '..', '..');

type Row = readonly [key: string, tone: Tone, icon: string, label: string];

function rows(map: Readonly<Record<string, StateLook>>): Row[] {
  return Object.entries(map).map(([key, look]) => [key, look.tone, look.icon, look.label] as const);
}

/** The `as const` list a module exports, read from its source: the design system may not import modules. */
function constList(file: string, name: string): string[] {
  const source = readFileSync(join(REPO, file), 'utf8');
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(source);
  if (!match) throw new Error(`${file} no longer exports ${name} as a const list`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((item) => item[1]!);
}

describe('the ticket-state maps match the specification', () => {
  it('maps every canonical ticket state', () => {
    expect(rows(TICKET_STATE_LOOK)).toEqual([
      ['new', 'neutral', 'circle-dashed', 'New'],
      ['in_progress', 'info', 'clock', 'In progress'],
      ['pending_requester', 'hold', 'pause', 'Waiting on requester'],
      ['pending_third_party', 'hold', 'pause', 'Waiting on third party'],
      ['pending_approval', 'hold', 'hourglass', 'Awaiting approval'],
      ['reopened', 'info', 'refresh-cw', 'Reopened'],
      ['resolved', 'success', 'circle-check', 'Resolved'],
      ['closed', 'neutral', 'archive', 'Closed'],
      ['cancelled', 'neutral', 'ban', 'Cancelled'],
    ]);
  });

  it('maps every status category', () => {
    expect(rows(STATUS_CATEGORY_LOOK)).toEqual([
      ['open', 'info', 'circle-dot', 'Open'],
      ['paused', 'hold', 'pause', 'Paused'],
      ['resolved', 'success', 'circle-check', 'Resolved'],
      ['closed', 'neutral', 'archive', 'Closed'],
    ]);
  });

  it('maps every SLA state, with amber only for due soon', () => {
    expect(rows(SLA_STATE_LOOK)).toEqual([
      ['on_track', 'success', 'circle-check', 'On track'],
      ['due_soon', 'warning', 'clock', 'Due soon'],
      ['breached', 'danger', 'circle-alert', 'Breached'],
      ['paused', 'hold', 'pause', 'SLA paused'],
      ['met', 'success', 'circle-check', 'Met'],
      ['none', 'neutral', 'dot', '—'],
    ]);
  });

  it('maps every approval state, and says Withdrawn when nobody turned it down', () => {
    expect(rows(APPROVAL_STATE_LOOK)).toEqual([
      ['pending', 'hold', 'hourglass', 'Awaiting decision'],
      ['approved', 'success', 'circle-check', 'Approved'],
      ['rejected', 'danger', 'circle-x', 'Rejected'],
      ['cancelled', 'neutral', 'ban', 'Cancelled'],
      ['expired', 'neutral', 'clock', 'Expired'],
    ]);
    expect(approvalStateLook('cancelled', 'withdrawn')).toEqual({ tone: 'neutral', icon: 'ban', label: 'Withdrawn' });
    expect(approvalStateLook('cancelled', null)).toBe(APPROVAL_STATE_LOOK.cancelled);
    expect(approvalStateLook('approved', 'withdrawn')).toBe(APPROVAL_STATE_LOOK.approved);
    expect(approvalStateLook('on_hold')).toEqual({ tone: 'neutral', icon: 'dot', label: 'On hold' });
  });

  it('maps every ticket type to a neutral tile', () => {
    expect(rows(TYPE_LOOK)).toEqual([
      ['incident', 'neutral', 'circle-alert', 'Incident'],
      ['request', 'neutral', 'package', 'Request'],
      ['question', 'neutral', 'message-circle', 'Question'],
      ['problem', 'neutral', 'bug', 'Problem'],
      ['change', 'neutral', 'git-compare', 'Change'],
      ['task', 'neutral', 'square-check', 'Task'],
    ]);
    expect(ticketTypeLook('change')).toBe(TYPE_LOOK.change);
    expect(ticketTypeLook('service_request')).toEqual({ tone: 'neutral', icon: 'ticket', label: 'Service request' });
  });

  it('maps every status-page component state, with a full outage solid', () => {
    expect(rows(COMPONENT_STATE_LOOK)).toEqual([
      ['operational', 'success', 'circle-check', 'Running'],
      ['degraded', 'high', 'triangle-alert', 'Degraded'],
      ['partial_outage', 'danger', 'circle-alert', 'Partly down'],
      ['major_outage', 'danger', 'circle-x', 'Down'],
      ['maintenance', 'info', 'wrench', 'Maintenance'],
    ]);
    expect(COMPONENT_STATE_LOOK.major_outage.emphasis).toBe('solid');
    expect(Object.values(COMPONENT_STATE_LOOK).filter((look) => look.emphasis === 'solid')).toHaveLength(1);
  });

  it('maps every problem state, a known error as good news', () => {
    expect(rows(PROBLEM_STATE_LOOK)).toEqual([
      ['investigating', 'info', 'search', 'Investigating'],
      ['known_error', 'info', 'book-open', 'Known error · workaround'],
      ['resolved', 'success', 'circle-check', 'Resolved'],
      ['closed', 'neutral', 'archive', 'Closed'],
    ]);
  });

  it('draws a major incident as the solid danger pill', () => {
    expect(MAJOR_INCIDENT_LOOK).toEqual({ tone: 'danger', icon: 'circle-alert', label: 'Major incident', emphasis: 'solid' });
  });

  it('draws priorities as bars: P1 and P2 three, P3 two, P4 one and quiet', () => {
    expect(PRIORITY_LOOK).toEqual({
      P1: { tone: 'danger', bars: 3, quiet: false, label: 'P1', words: 'Critical', chartTone: 'danger' },
      P2: { tone: 'high', bars: 3, quiet: false, label: 'P2', words: 'High', chartTone: 'high' },
      P3: { tone: 'neutral', bars: 2, quiet: false, label: 'P3', words: 'Medium', chartTone: 'neutral' },
      P4: { tone: 'neutral', bars: 1, quiet: true, label: 'P4', words: 'Low', chartTone: 'neutralSoft' },
    });
    expect(priorityLook('P2')).toBe(PRIORITY_LOOK.P2);
    expect(priorityLook('P5')).toBeUndefined();
    expect(priorityLook('toString')).toBeUndefined();
    expect(priorityLook(null)).toBeUndefined();
  });
});

describe('the keys are the ones the product produces', () => {
  it('covers the canonical states, categories, types and priorities of the API contract', () => {
    expect(Object.keys(TICKET_STATE_LOOK).sort()).toEqual([...canonicalStateSchema.options].sort());
    expect(Object.keys(STATUS_CATEGORY_LOOK).sort()).toEqual([...statusCategorySchema.options].sort());
    expect(Object.keys(TYPE_LOOK).sort()).toEqual([...ticketTypeSchema.options].sort());
    expect(Object.keys(PRIORITY_LOOK).sort()).toEqual([...prioritySchema.options].sort());
  });

  it('covers the status-page component states and the problem states, read from their modules', () => {
    expect(Object.keys(COMPONENT_STATE_LOOK).sort()).toEqual(constList('modules/statuspage/src/domain/status.ts', 'COMPONENT_STATUSES').sort());
    expect(Object.keys(PROBLEM_STATE_LOOK).sort()).toEqual(constList('modules/problem/src/domain/lifecycle.ts', 'PROBLEM_STATES').sort());
  });
});

describe('the palette guard rules (D5)', () => {
  const stateMaps = {
    TICKET_STATE_LOOK,
    STATUS_CATEGORY_LOOK,
    TYPE_LOOK,
    COMPONENT_STATE_LOOK,
    PROBLEM_STATE_LOOK,
    APPROVAL_STATE_LOOK,
  } as const;
  const allLooks: [string, StateLook][] = [
    ...Object.entries(stateMaps).flatMap(([name, map]) => Object.entries(map).map(([key, look]) => [`${name}.${key}`, look] as [string, StateLook])),
    ...Object.entries(SLA_STATE_LOOK).map(([key, look]) => [`SLA_STATE_LOOK.${key}`, look] as [string, StateLook]),
    ['MAJOR_INCIDENT_LOOK', MAJOR_INCIDENT_LOOK],
  ];

  it('gives every state a label and a registered icon, so colour is never the only cue', () => {
    for (const [name, look] of allLooks) {
      expect(look.label.trim(), name).not.toBe('');
      expect(isIconName(look.icon), `${name} draws ${look.icon}`).toBe(true);
    }
    for (const [key, look] of Object.entries(PRIORITY_LOOK)) {
      expect([1, 2, 3], key).toContain(look.bars);
      expect(look.words, key).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('never maps a ticket state, type, component state, problem state or approval to amber', () => {
    for (const [name, map] of Object.entries(stateMaps)) {
      for (const [key, look] of Object.entries(map)) expect(look.tone, `${name}.${key}`).not.toBe('warning');
    }
    for (const [key, look] of Object.entries(PRIORITY_LOOK)) expect(look.tone, key).not.toBe('warning');
  });

  it('keeps amber for SLA risk alone', () => {
    const amber = allLooks.filter(([, look]) => look.tone === 'warning').map(([name]) => name);
    expect(amber).toEqual(['SLA_STATE_LOOK.due_soon']);
  });

  it('never paints a state in the control blue', () => {
    for (const [name, look] of allLooks) expect(look.tone, name).not.toBe('accent');
  });

  it('paints a priority in a chart with a status tone, never an identity colour', () => {
    for (const look of Object.values(PRIORITY_LOOK)) {
      expect(chartToneVar[look.chartTone]).toMatch(/^var\(--itsm-colour-(?:[a-z]+-border|chart-neutralSoft)\)$/);
    }
  });

  it('freezes every map, so a page cannot recolour a state for everybody', () => {
    for (const map of [...Object.values(stateMaps), SLA_STATE_LOOK, PRIORITY_LOOK]) {
      expect(Object.isFrozen(map)).toBe(true);
      for (const look of Object.values(map)) expect(Object.isFrozen(look)).toBe(true);
    }
    expect(Object.isFrozen(MAJOR_INCIDENT_LOOK)).toBe(true);
  });
});

describe('ticketStateLook', () => {
  it('returns a canonical state’s own look, ready to spread into a pill', () => {
    expect(ticketStateLook('pending_requester')).toBe(TICKET_STATE_LOOK.pending_requester);
    expect(ticketStateLook('reopened', 'open')).toBe(TICKET_STATE_LOOK.reopened);
  });

  it('gives a tenant’s own status its category’s tone and icon, in its own words', () => {
    expect(ticketStateLook('awaiting_parts', 'paused')).toEqual({ tone: 'hold', icon: 'pause', label: 'Awaiting parts' });
    expect(ticketStateLook('triage', 'open')).toEqual({ tone: 'info', icon: 'circle-dot', label: 'Triage' });
    expect(ticketStateLook('VIP_review', 'open').label).toBe('VIP review');
    expect(ticketStateLook('fixed-in-release', 'resolved')).toEqual({ tone: 'success', icon: 'circle-check', label: 'Fixed in release' });
  });

  it('draws a status nobody described as plain neutral rather than guessing a colour', () => {
    expect(ticketStateLook('on_hold')).toEqual({ tone: 'neutral', icon: 'dot', label: 'On hold' });
    expect(ticketStateLook('on_hold', 'archived')).toEqual({ tone: 'neutral', icon: 'dot', label: 'On hold' });
  });

  it('does not take an inherited property for a state', () => {
    expect(ticketStateLook('toString')).toEqual({ tone: 'neutral', icon: 'dot', label: 'ToString' });
    expect(ticketStateLook('triage', 'constructor')).toEqual({ tone: 'neutral', icon: 'dot', label: 'Triage' });
  });
});

describe('the module stays safe for a client bundle (Y-B2)', () => {
  const file = 'display/ticket-states.ts';
  const source = readFileSync(join(SRC, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  it('imports @itsm/contracts for types only, so no zod reaches the browser', () => {
    const contractImports = tree.statements.filter(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith('@itsm/contracts'),
    );
    expect(contractImports.length).toBeGreaterThan(0);
    for (const statement of contractImports) expect(statement.importClause?.isTypeOnly, statement.getText(tree)).toBe(true);
  });

  it('has no directive, no React and no runtime import at all', () => {
    expect(source.startsWith("'use client'")).toBe(false);
    const runtime = tree.statements.filter((statement) => ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly);
    expect(runtime.map((statement) => statement.getText(tree))).toEqual([]);
  });
});

describe('the tones the maps paint with', () => {
  it('adds hold and high to the tone vocabulary, each with its own intent and shape', () => {
    expect(tones).toEqual(['neutral', 'accent', 'info', 'success', 'warning', 'danger', 'hold', 'high']);
    expect(toneIntent.hold).toBe('hold');
    expect(toneIntent.high).toBe('high');
    expect(toneIntent.accent).toBe('brand');
    expect(toneIcon.hold).toBe('pause');
    expect(toneIcon.high).toBe('flag');
    expect(statusIcon.hold).toBe('pause');
    expect(statusIcon.high).toBe('flag');
  });

  it('gives every tone a distinct icon in a pill, so no two read alike without colour', () => {
    const shapes = tones.map((tone) => statusIcon[tone]);
    expect(new Set(shapes).size).toBe(tones.length);
  });

  it('writes the local tone variables for hold and high from tokens the pipeline emits', () => {
    const notice = toneRules('.x');
    const pill = toneVariables('.x');
    for (const tone of ['hold', 'high'] as const) {
      expect(notice).toContain(`.x[data-tone="${tone}"] {\n  --_itsm-tone-subtle: var(--itsm-colour-${tone}-subtle);`);
      expect(pill).toContain(`--_itsm-tone-solidText: var(--itsm-colour-${tone}-solidText);`);
    }
    expect(unknownVariables(notice)).toEqual([]);
    expect(unknownVariables(pill)).toEqual([]);
  });
});

describe('chart tones', () => {
  const chartTones: readonly ChartTone[] = ['danger', 'high', 'warning', 'success', 'info', 'hold', 'neutral', 'neutralSoft'];

  it('paints each status tone with its intent’s border colour, the one audited at 3:1 on a card', () => {
    expect(chartToneVar).toEqual({
      danger: 'var(--itsm-colour-danger-border)',
      high: 'var(--itsm-colour-high-border)',
      warning: 'var(--itsm-colour-warning-border)',
      success: 'var(--itsm-colour-success-border)',
      info: 'var(--itsm-colour-info-border)',
      hold: 'var(--itsm-colour-hold-border)',
      neutral: 'var(--itsm-colour-neutral-border)',
      neutralSoft: 'var(--itsm-colour-chart-neutralSoft)',
    });
    expect(Object.keys(chartToneVar)).toEqual(chartTones);
  });

  it('outlines the quiet fill, which is under 3:1 on its own, and nothing else', () => {
    expect(chartToneOutline).toEqual({ neutralSoft: 'var(--itsm-colour-neutral-border)' });
  });

  it('never borrows a categorical slot, so status and identity never share a chart', () => {
    for (const value of [...Object.values(chartToneVar), ...Object.values(chartToneOutline)]) {
      expect(value).not.toMatch(/--itsm-colour-chart-\d/);
    }
  });

  it('references only variables the tokens emit', () => {
    expect(unknownVariables([...Object.values(chartToneVar), ...Object.values(chartToneOutline)].join('\n'))).toEqual([]);
  });
});

describe('the icons the maps and the frames need', () => {
  it.each(['circle-dot', 'bug', 'minus-circle', 'wrench', 'siren', 'package', 'message-circle', 'git-compare', 'square-check', 'book-open', 'chart-bar', 'megaphone', 'repeat', 'zap'])(
    'registers %s',
    (name) => {
      expect(isIconName(name)).toBe(true);
    },
  );
});
