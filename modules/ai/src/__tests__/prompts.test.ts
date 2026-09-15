import { describe, expect, it } from 'vitest';
import { renderStrict } from '@itsm/module-workflow';
import { SHIPPED_DATASETS, SHIPPED_PROMPTS } from '../seed/prompts.js';
import { PROMPT_PATHS, unknownPaths } from '../service/prompt-service.js';
import { scoreCase } from '../service/eval-service.js';
import { stubProvider } from '../providers/stub.js';
import { CAPABILITY_CATALOGUE, isCapability, type Capability } from '../domain/capabilities.js';

/**
 * Every prompt this deployment ships, put through the checks a promotion
 * makes — here, in the unit suite, on every change.
 *
 * This is what gives "the shipped prompt is promoted by release rather than by
 * an evaluation run" its teeth: the release cannot happen if a shipped prompt
 * fails its own dataset. Be precise about what that proves. Behind the socket
 * is the stub, so what is demonstrated is that the template renders, that its
 * answer parses into the capability's shape, and that the scoring machinery
 * works end to end. It is not evidence that a prompt is any good, and nothing
 * here should be quoted as though it were. That becomes true the day OD-04 is
 * closed, with no change to this file.
 */
describe('the prompts this deployment ships', () => {
  it('ships one for every capability that calls a model, and none for the one that does not', () => {
    const shipped = new Set(SHIPPED_PROMPTS.map((prompt) => prompt.capability));
    for (const [key, definition] of Object.entries(CAPABILITY_CATALOGUE)) {
      expect(shipped.has(key), key).toBe(definition.promptKey !== null);
    }
  });

  it('reads only paths the context assembler provides', () => {
    for (const prompt of SHIPPED_PROMPTS) {
      expect(unknownPaths(prompt.template), `${prompt.key}: ${unknownPaths(prompt.template).join(', ')}`).toEqual([]);
      expect(unknownPaths(prompt.systemPrompt)).toEqual([]);
    }
  });

  it('tells the model to answer only from what it was given', () => {
    // The single most consequential sentence in the module. A prompt that
    // loses it produces confident, unsupported answers that read exactly like
    // the good ones.
    for (const prompt of SHIPPED_PROMPTS) {
      expect(prompt.systemPrompt, prompt.key).toMatch(/only from/i);
      expect(prompt.systemPrompt, prompt.key).toMatch(/never invent/i);
    }
  });

  it('renders against every case in its dataset without a hole in it', () => {
    for (const dataset of SHIPPED_DATASETS) {
      const prompt = SHIPPED_PROMPTS.find((candidate) => candidate.capability === dataset.capability)!;
      for (const one of dataset.cases) {
        expect(() => renderStrict(prompt.template, one.context as never), `${prompt.key}/${one.key}`).not.toThrow();
      }
    }
  });

  it('scores at or above its own threshold, so a release cannot ship a prompt a promotion would refuse', async () => {
    const provider = stubProvider();
    for (const dataset of SHIPPED_DATASETS) {
      expect(isCapability(dataset.capability)).toBe(true);
      const capability = dataset.capability as Capability;
      const prompt = SHIPPED_PROMPTS.find((candidate) => candidate.capability === dataset.capability)!;

      const scores = [];
      for (const one of dataset.cases) {
        const completion = await provider.complete({
          capability,
          systemPrompt: renderStrict(prompt.systemPrompt, one.context as never),
          prompt: renderStrict(prompt.template, one.context as never),
          model: 'stub-small',
          maxOutputTokens: 1500,
        });
        scores.push(scoreCase(capability, one.key, completion.text, one.expect));
      }

      const score = scores.reduce((total, one) => total + one.score, 0) / scores.length;
      const failed = scores.filter((one) => one.failures.length > 0);
      expect(score, `${dataset.key}: ${failed.map((one) => `${one.key} — ${one.failures.join('; ')}`).join(' | ')}`).toBeGreaterThanOrEqual(
        dataset.threshold,
      );
    }
  });

  it('has a dataset for every capability whose catalogue entry names one', () => {
    const datasets = new Set(SHIPPED_DATASETS.map((dataset) => dataset.key));
    for (const definition of Object.values(CAPABILITY_CATALOGUE)) {
      if (definition.datasetKey === null) continue;
      expect(datasets.has(definition.datasetKey), definition.key).toBe(true);
    }
  });
});

describe('refusing a prompt that could not run', () => {
  it('names the path it does not recognise, and what it could have read', () => {
    expect(unknownPaths('Hello {{ticket.title}} and {{secrets.apiKey}}')).toEqual(['secrets.apiKey']);
    expect(PROMPT_PATHS).toContain('ticket');
    expect(PROMPT_PATHS).not.toContain('secrets');
  });

  it('accepts any depth under a path it does recognise', () => {
    expect(unknownPaths('{{ticket.title}} {{requester.displayName}} {{tone}}')).toEqual([]);
  });
});
