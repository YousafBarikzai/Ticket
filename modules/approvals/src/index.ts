/** MOD-17 Approvals — public interface (docs/architecture/04 §3). */
export { approvalsManifest } from './manifest.js';
export * as approvalService from './service/approval-service.js';
export {
  requestApproval,
  decide,
  getApproval,
  listMyApprovals,
  listApprovalsForTicket,
} from './service/approval-service.js';
export type { ApprovalSubject, CurrentStep, Described, DescribedDetail } from './service/approval-context.js';
export { labelAnswers, type ApprovalAnswer } from './domain/answers.js';
export { resolveApprovers, approverSlotFor, applyDelegations } from './service/approver-resolver.js';
export {
  SUBJECT_TYPES,
  DECISIONS,
  APPROVERS_NOT_YET_AVAILABLE,
  policyDefinitionSchema,
  stepSchema,
  approverRuleSchema,
  settleStep,
  resolveQuorum,
  type ApproverRule,
  type PolicyDefinition,
  type PolicyStep,
  type SubjectType,
} from './domain/policy.js';
export { seedApprovalDefaults } from './seed/defaults.js';
import './handlers/index.js';
