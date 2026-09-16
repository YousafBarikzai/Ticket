import { z } from 'zod';
import { ValidationError } from '@itsm/platform';
import {
  isFieldElement,
  submissionValues,
  validateForm,
  withDefaults,
  type FormDefinition,
  type FormValues,
} from '@itsm/contracts';

/**
 * A survey document: MOD-02's form shape, plus a scoring rule.
 *
 * Reusing the form contract is the decision. The questions a survey asks —
 * a rating, a choice, a free-text box — are fields, with the same visibility
 * conditions and the same validation the catalogue uses, and a second question
 * schema would be a second set of rules that disagree the first time either
 * changed. What a survey adds is one thing a form does not have: which answer
 * is *the* answer, and what scale it was asked on, so MOD-12 can put a 1–5 and
 * a 0–10 survey on the same chart.
 */

export const scoringSchema = z.object({
  /** The field whose answer is the headline score. */
  field: z.string().min(1).max(60),
  min: z.number().int(),
  max: z.number().int(),
  /** The free-text field shown alongside the score, if any. */
  commentField: z.string().min(1).max(60).optional(),
});
export type Scoring = z.infer<typeof scoringSchema>;

export const surveyDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  /** Shown once they have answered. */
  thanks: z.string().max(500).optional(),
  schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  ui: z.object({ elements: z.array(z.unknown()) }),
  scoring: scoringSchema.optional(),
});
export type SurveyDocument = z.infer<typeof surveyDocumentSchema>;

/** The document as a form definition, for the shared validator. */
export function asForm(document: SurveyDocument, key: string, version: number): FormDefinition {
  return {
    key,
    version,
    title: document.title,
    ...(document.description ? { description: document.description } : {}),
    schema: document.schema as FormDefinition['schema'],
    ui: document.ui as FormDefinition['ui'],
  };
}

/**
 * Checks the document hangs together before it can be published: the scored
 * field exists, is numeric, and the scale it declares is the range the field
 * accepts — a survey scored 1–5 over a question that allows 0–10 would report
 * a 7 as 150 %.
 */
export function assertDocumentIsCoherent(document: SurveyDocument): void {
  const fields = new Set(
    (document.ui.elements as { kind?: string; field?: string }[]).filter((element) => element.kind === 'field').map((element) => element.field),
  );
  for (const name of Object.keys(document.schema.properties)) {
    if (!fields.has(name)) throw new ValidationError(`question "${name}" is in the schema but never shown`);
  }

  const scoring = document.scoring;
  if (!scoring) return;

  const property = document.schema.properties[scoring.field] as { type?: string; minimum?: number; maximum?: number } | undefined;
  if (!property) throw new ValidationError(`scoring names "${scoring.field}", which is not a question`);
  if (property.type !== 'number' && property.type !== 'integer') {
    throw new ValidationError(`the scored question "${scoring.field}" must be numeric`);
  }
  if (scoring.max <= scoring.min) throw new ValidationError('a scale must run upwards');
  if ((property.minimum !== undefined && property.minimum !== scoring.min) || (property.maximum !== undefined && property.maximum !== scoring.max)) {
    throw new ValidationError(`the scored question accepts ${property.minimum ?? '?'}–${property.maximum ?? '?'} but the scale says ${scoring.min}–${scoring.max}`);
  }
  if (scoring.commentField && !document.schema.properties[scoring.commentField]) {
    throw new ValidationError(`scoring names a comment field "${scoring.commentField}" that is not a question`);
  }
}

/**
 * A raw answer on the survey's scale, as a number out of 100.
 *
 * Linear, with the bottom of the scale at zero: a 1 on a 1–5 scale is 0, not
 * 20, because "the worst answer available" should read as the worst answer.
 * A 10 on 0–10 is 100 and a 5 is 50; a 3 on 1–5 is 50. That is what makes the
 * two comparable on one axis.
 */
export function normaliseScore(value: number, scoring: Pick<Scoring, 'min' | 'max'>): number {
  const clamped = Math.min(scoring.max, Math.max(scoring.min, value));
  return Math.round(((clamped - scoring.min) / (scoring.max - scoring.min)) * 100);
}

export function scaleLabel(scoring: Pick<Scoring, 'min' | 'max'>): string {
  return `${scoring.min}-${scoring.max}`;
}

export interface AnswerOutcome {
  ok: boolean;
  errors: Record<string, string>;
  accepted: FormValues;
  score: number | null;
  scale: string | null;
  comment: string | null;
}

/**
 * Validates answers against the version the person was shown, and extracts
 * the headline score and comment. Answers to hidden questions are dropped
 * rather than rejected, exactly as a catalogue submission is.
 */
export function evaluateAnswers(document: SurveyDocument, key: string, version: number, answers: FormValues): AnswerOutcome {
  const form = asForm(document, key, version);
  const withApplied = withDefaults(form, answers);
  const errors = validateForm(form, withApplied, {});
  const accepted = submissionValues(form, withApplied, {});

  const scoring = document.scoring;
  const raw = scoring ? accepted[scoring.field] : undefined;
  const score = scoring && typeof raw === 'number' ? normaliseScore(raw, scoring) : null;
  const commentRaw = scoring?.commentField ? accepted[scoring.commentField] : undefined;
  const comment = typeof commentRaw === 'string' && commentRaw.trim().length > 0 ? commentRaw.trim().slice(0, 4000) : null;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    accepted,
    score,
    scale: scoring ? scaleLabel(scoring) : null,
    comment,
  };
}

/** The questions, in order, for a renderer that has no form engine. */
export function questionsOf(document: SurveyDocument): { field: string; label: string; control: string; options?: { value: string; label: string }[]; min?: number; max?: number; required: boolean }[] {
  const required = new Set(document.schema.required ?? []);
  return (document.ui.elements as unknown[])
    .filter((element): element is { kind: 'field'; field: string; label?: string; control?: string; options?: { value: string; label: string }[] } =>
      isFieldElement(element as never),
    )
    .map((element) => {
      const property = document.schema.properties[element.field] as { title?: string; minimum?: number; maximum?: number } | undefined;
      return {
        field: element.field,
        label: element.label ?? property?.title ?? element.field,
        control: element.control ?? 'text',
        ...(element.options ? { options: element.options } : {}),
        ...(property?.minimum !== undefined ? { min: property.minimum } : {}),
        ...(property?.maximum !== undefined ? { max: property.maximum } : {}),
        required: required.has(element.field),
      };
    });
}
