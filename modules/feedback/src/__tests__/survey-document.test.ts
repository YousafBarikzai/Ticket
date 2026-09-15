import { describe, expect, it } from 'vitest';
import { ValidationError } from '@itsm/platform';
import { assertDocumentIsCoherent, evaluateAnswers, normaliseScore, questionsOf, scaleLabel, type SurveyDocument } from '../domain/survey-document.js';
import { expiryFor, withinThrottle } from '../domain/throttle.js';
import { ratingActions } from '../service/invitation-service.js';
import { DEFAULT_SURVEY } from '../seed/defaults.js';

const csat: SurveyDocument = DEFAULT_SURVEY.document;

describe('the document', () => {
  it('ships a default that passes its own checks', () => {
    expect(() => assertDocumentIsCoherent(csat)).not.toThrow();
  });

  it('refuses a scored question that is not a question', () => {
    expect(() => assertDocumentIsCoherent({ ...csat, scoring: { field: 'mood', min: 1, max: 5 } })).toThrow(/not a question/);
  });

  it('refuses a scale that disagrees with the question', () => {
    // A 7 on a 0–10 question scored 1–5 would be 150 %.
    expect(() => assertDocumentIsCoherent({ ...csat, scoring: { field: 'rating', min: 0, max: 10 } })).toThrow(/scale says/);
  });

  it('refuses a scored question that is text', () => {
    expect(() => assertDocumentIsCoherent({ ...csat, scoring: { field: 'comment', min: 1, max: 5 } })).toThrow(/numeric/);
  });

  it('refuses a question in the schema that is never shown', () => {
    const document: SurveyDocument = {
      ...csat,
      schema: { ...csat.schema, properties: { ...csat.schema.properties, hidden: { type: 'string' } } },
    };
    expect(() => assertDocumentIsCoherent(document)).toThrow(/never shown/);
  });

  it('lists the questions in the order they are shown', () => {
    expect(questionsOf(csat).map((question) => question.field)).toEqual(['rating', 'comment']);
    expect(questionsOf(csat)[0]).toMatchObject({ control: 'number', min: 1, max: 5, required: true });
  });
});

describe('the score', () => {
  it('puts the bottom of the scale at zero and the top at a hundred', () => {
    // A 1 on 1–5 is the worst answer available and reads as the worst answer.
    expect(normaliseScore(1, { min: 1, max: 5 })).toBe(0);
    expect(normaliseScore(5, { min: 1, max: 5 })).toBe(100);
    expect(normaliseScore(3, { min: 1, max: 5 })).toBe(50);
  });

  it('makes a 0–10 and a 1–5 survey comparable', () => {
    expect(normaliseScore(5, { min: 0, max: 10 })).toBe(50);
    expect(normaliseScore(10, { min: 0, max: 10 })).toBe(100);
    expect(scaleLabel({ min: 0, max: 10 })).toBe('0-10');
  });

  it('clamps an answer outside the scale rather than exceeding a hundred', () => {
    expect(normaliseScore(9, { min: 1, max: 5 })).toBe(100);
    expect(normaliseScore(-3, { min: 1, max: 5 })).toBe(0);
  });
});

describe('answers', () => {
  it('validates against the version shown and extracts the headline', () => {
    const outcome = evaluateAnswers(csat, 'csat', 1, { rating: 4, comment: '  Quick and friendly.  ' });
    expect(outcome.ok).toBe(true);
    expect(outcome.score).toBe(75);
    expect(outcome.scale).toBe('1-5');
    expect(outcome.comment).toBe('Quick and friendly.');
  });

  it('names the missing required answer', () => {
    const outcome = evaluateAnswers(csat, 'csat', 1, { comment: 'no rating' });
    expect(outcome.ok).toBe(false);
    expect(Object.keys(outcome.errors)).toContain('rating');
  });

  it('treats an empty comment as no comment', () => {
    expect(evaluateAnswers(csat, 'csat', 1, { rating: 2, comment: '   ' }).comment).toBeNull();
  });

  it('has no score when the survey has no scored question', () => {
    const { scoring: _dropped, ...unscored } = csat;
    const outcome = evaluateAnswers(unscored as SurveyDocument, 'csat', 1, { rating: 4 });
    expect(outcome.score).toBeNull();
    expect(outcome.scale).toBeNull();
  });
});

describe('asking again', () => {
  const now = new Date('2026-03-15T09:00:00Z');

  it('waits the window out', () => {
    expect(withinThrottle({ lastInvitedAt: new Date('2026-03-12T09:00:00Z'), throttleDays: 7, now })).toBe(true);
    expect(withinThrottle({ lastInvitedAt: new Date('2026-03-01T09:00:00Z'), throttleDays: 7, now })).toBe(false);
  });

  it('never throttles a first ask, or when the window is zero', () => {
    expect(withinThrottle({ lastInvitedAt: null, throttleDays: 7, now })).toBe(false);
    expect(withinThrottle({ lastInvitedAt: now, throttleDays: 0, now })).toBe(false);
  });

  it('expires at least a day out', () => {
    expect(expiryFor(now, 0).getTime() - now.getTime()).toBe(24 * 3600 * 1000);
  });
});

describe('buttons', () => {
  it('offers one button per point on a short scale', () => {
    const actions = ratingActions({ min: 1, max: 5 }, 'inv-1');
    expect(actions.map((action) => action.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(actions[0]!.value).toEqual({ action: 'custom', name: 'survey', data: { invitationId: 'inv-1', value: 1 } });
  });

  it('offers none for a scale too wide to be buttons', () => {
    // Eleven buttons is not a question, it is a keyboard.
    expect(ratingActions({ min: 0, max: 10 }, 'inv-1')).toEqual([]);
    expect(ratingActions(undefined, 'inv-1')).toEqual([]);
  });
});

describe('ValidationError is what an unanswerable survey raises', () => {
  it('is the error type the API maps to 422', () => {
    expect(new ValidationError('x').status).toBe(422);
  });
});
