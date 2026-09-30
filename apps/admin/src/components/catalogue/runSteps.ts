import { api } from '../../client/api.js';
import type { Step } from './save.js';

/**
 * Sends a save plan (`planSave`) to the API one step at a time, stopping at
 * the first that fails — the order is the point: a form must be published
 * before a request type may point at it.
 */
export async function runSteps(steps: readonly Step[]): Promise<void> {
  const catalogue = api.configure.catalogue;
  for (const step of steps) {
    switch (step.kind) {
      case 'createForm':
        await catalogue.createForm(step.input as unknown as Record<string, unknown>);
        break;
      case 'updateForm':
        await catalogue.updateForm(step.key, step.patch as Record<string, unknown>);
        break;
      case 'publishForm':
        await catalogue.publishForm(step.key);
        break;
      case 'createType':
        await catalogue.createRequestType(step.input);
        break;
      case 'updateType':
        await catalogue.updateRequestType(step.key, step.patch);
        break;
      case 'publishType':
        await catalogue.publishRequestType(step.key);
        break;
    }
  }
}
