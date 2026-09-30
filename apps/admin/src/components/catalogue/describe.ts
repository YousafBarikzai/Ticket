import { fromExpression, OPERATORS, isUnary } from '../../rules.js';
import { factFor, valueLabel, type Fact } from '../../rules/facts.js';

/**
 * A condition as a sentence — "Access level is Administrator", "Priority
 * is P1 · Critical or Type is Incident" — for the chips on a question and
 * the *Required* column of Ticket fields, where the builder itself would be
 * too much. Anything the builder cannot draw reads "a custom condition"
 * rather than half of what it says.
 */

const OPERATOR_WORDS = new Map<string, string>(OPERATORS.map((entry) => [entry.value, entry.label]));

export function describeCondition(expression: unknown, facts: readonly Fact[] = []): string {
  if (expression === null || expression === undefined) return 'always';
  const parsed = fromExpression(expression);
  if (!parsed) return 'a custom condition';
  if (parsed.conditions.length === 0) return 'always';
  const lookup = (path: string): Fact => facts.find((fact) => fact.path === path) ?? factFor(path);
  const clauses = parsed.conditions.map((condition) => {
    const fact = lookup(condition.fact);
    const verb = fact.operators?.includes('contains') && condition.operator === 'contains' ? 'includes' : (OPERATOR_WORDS.get(condition.operator) ?? condition.operator);
    return isUnary(condition.operator) ? `${fact.label} ${verb}` : `${fact.label} ${verb} ${valueLabel(fact, condition.value)}`;
  });
  return clauses.join(parsed.join === 'and' ? ' and ' : ' or ');
}
