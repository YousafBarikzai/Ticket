/**
 * The form logic, re-exported from `@itsm/contracts/forms`.
 *
 * See `./schema.ts`: the server runs these same functions when it validates a
 * submission, which is why they live in the contract and not here.
 */
export {
  brokenConditions,
  buildEvalContext,
  isEmpty,
  isReadOnly,
  isRequired,
  isVisible,
  submissionValues,
  validateForm,
  visibleElements,
  visibleFields,
  withDefaults,
  type FormErrors,
  type FormEvalExtras,
} from '@itsm/contracts/forms';
