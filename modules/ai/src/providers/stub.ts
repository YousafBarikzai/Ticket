import { approximateTokens } from '../domain/output.js';
import type { AiProvider, Completion, CompletionRequest, Decision, DecisionAnswer, DecisionQuestion, DecisionRequest } from './types.js';

/**
 * A provider that answers without a model.
 *
 * It exists so that everything around the socket — budgets, evidence,
 * evaluation, the suggestion lifecycle, the refusals — can be built and proved
 * before OD-04 is decided, instead of being written in a hurry on the day a
 * provider is chosen. It is deterministic, so a test that runs it twice gets
 * the same answer, and it is priced like a real mid-sized model so a budget
 * that looks sensible here still looks sensible later.
 *
 * It reads the rendered prompt the way a person skimming it would: the title
 * line, and the bulleted evidence under the evidence heading. That coupling to
 * the prompt's own layout is a thing a stub is allowed and a real provider
 * never needs — and it is why an evaluation run against this provider proves
 * the *machinery* (that a threshold blocks a promotion, that a failing case
 * names itself) rather than the quality of a prompt. Nothing here should be
 * read as a score a prompt earned.
 */

const TITLE = /^Title:\s*(.+)$/m;
const BULLET = /^\s*-\s+(.+)$/gm;

function subjectOf(prompt: string): string {
  return TITLE.exec(prompt)?.[1]?.trim() ?? 'this request';
}

function evidenceIn(prompt: string): string[] {
  const start = prompt.indexOf('Evidence:');
  if (start < 0) return [];
  const section = prompt.slice(start);
  return [...section.matchAll(BULLET)].map((match) => match[1]!.trim()).slice(0, 8);
}

function answerFor(request: CompletionRequest): unknown {
  const subject = subjectOf(request.prompt);
  const evidence = evidenceIn(request.prompt);
  // Grounded answers are confident ones. Nothing subtler would be honest: the
  // stub has no opinion, so the only thing it can report is whether it was
  // given anything to work from.
  const confidence = evidence.length > 0 ? 0.9 : 0.4;
  const cited = evidence.length > 0 ? ` Based on ${evidence[0]}.` : '';

  switch (request.capability) {
    case 'reply-draft':
      return {
        text:
          `Thanks for getting in touch about ${subject}.\n\n` +
          `We have looked into it and here is where things stand.${cited}\n\n` +
          'If that does not resolve it, reply to this message and we will pick it straight back up.',
        reason: evidence.length > 0 ? `Drafted from ${evidence.length} related records.` : 'Drafted from the ticket alone.',
        confidence,
      };
    case 'ticket-summary':
      return {
        summary: `${subject}. The conversation so far covers what was reported, what has been tried, and where it stands now.`,
        nextSteps: ['Confirm the current state with the requester', 'Record what fixed it before closing'],
        reason: 'Summarised from the ticket and its comments.',
        confidence,
      };
    case 'article-draft':
      return {
        title: `How to resolve: ${subject}`,
        summary: `What to do when somebody reports ${subject}.`,
        body: [
          `This article covers ${subject}.`,
          'Symptoms: what the person reports, and how to tell this apart from the things it is usually mistaken for.',
          'Resolution: the steps that fixed it, in the order they were carried out.',
          'If this does not work: what to check next, and who to escalate to.',
        ],
        reason: evidence.length > 0 ? `Drafted from the ticket and ${evidence.length} existing articles.` : 'Drafted from the ticket.',
        confidence,
      };
    case 'similar-work':
      // Never reached: `similar-work` calls no provider. Here so that adding a
      // provider call to it later is a deliberate edit rather than a crash.
      return { items: [], reason: 'Retrieval only.', confidence };
  }
}

const WORD = /[a-z0-9]{3,}/g;
const URGENT = /\b(down|outage|everyone|all users|nobody can|cannot work|critical)\b/i;

function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}

/**
 * The stub's answer to one question: the option sharing most words with the
 * state, and a confidence that says how much it shared.
 *
 * Crude on purpose. It proves the chain, the checks, the record and the
 * scoring, and it must never be mistaken for triage — a stub that was good at
 * this would hide how good the real provider is not.
 */
function stubAnswer(question: DecisionQuestion, text: string, words: Set<string>): DecisionAnswer {
  switch (question.kind) {
    case 'choice': {
      let best = question.options[0] ?? null;
      let bestOverlap = 0;
      for (const option of question.options) {
        const overlap = [...wordsOf(option)].filter((word) => words.has(word)).length;
        if (overlap > bestOverlap) {
          best = option;
          bestOverlap = overlap;
        }
      }
      return { value: best, confidence: bestOverlap === 0 ? 0.3 : Math.min(0.95, 0.55 + 0.15 * bestOverlap) };
    }
    case 'score':
      return { value: (question.min + question.max) / 2, confidence: 0.5 };
    case 'yesno':
      return URGENT.test(text) ? { value: true, confidence: 0.7 } : { value: false, confidence: 0.6 };
  }
}

function stubDecision(request: DecisionRequest): Decision {
  const text = Object.values(request.state)
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const words = wordsOf(text);
  const answers: Decision['answers'] = {};
  for (const [key, question] of Object.entries(request.questions)) answers[key] = stubAnswer(question, text, words);
  return {
    answers,
    model: request.model,
    inputTokens: approximateTokens(JSON.stringify(request.state)) + approximateTokens(JSON.stringify(request.questions)),
    outputTokens: approximateTokens(JSON.stringify(answers)),
    providerRequestId: null,
  };
}

export function stubProvider(): AiProvider {
  return {
    name: 'stub',
    models: ['stub-small', 'stub-large'],
    // Nothing leaves the process, so there is no jurisdiction to name. Not a
    // loophole: the stub is registered only outside production, and any
    // provider that does make a call has to name a region for the gateway to
    // check it against.
    processingRegion: null,
    async complete(request: CompletionRequest): Promise<Completion> {
      const text = JSON.stringify(answerFor(request), null, 2);
      return {
        text,
        model: request.model,
        // A real provider reports what it charged for; the stub reports an
        // estimate, and says so by using the same estimator the platform would
        // have used if a provider had reported nothing.
        inputTokens: approximateTokens(request.systemPrompt) + approximateTokens(request.prompt),
        outputTokens: approximateTokens(text),
        finishReason: 'stop',
      };
    },
    async decide(request: DecisionRequest): Promise<Decision> {
      return stubDecision(request);
    },
  };
}
