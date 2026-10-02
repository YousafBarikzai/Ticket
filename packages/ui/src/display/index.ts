/**
 * Display and content: surfaces, pills, avatars, lists, disclosure, prose,
 * steppers, attachments and activity. Part of the root entry.
 *
 * `Card`, `Tile`, `Badge`, `Avatar`, `Table`, `Timeline` and `RichText` live in
 * `web/`, where the applications import them from today.
 */
export { ActivityFeed, type ActivityActor, type ActivityFeedProps, type ActivityItem } from './ActivityFeed.js';
export { AvatarStack, type AvatarStackPerson, type AvatarStackProps } from './AvatarStack.js';
export { channelInfo, channelPhrase, type ChannelInfo } from './channel.js';
export { Count, type CountProps } from './Count.js';
export { dayHeading, dayKey } from './dates.js';
export { DescriptionList, type DescriptionItem, type DescriptionListProps } from './DescriptionList.js';
export { Disclosure, type DisclosureProps } from './Disclosure.js';
export { disclosureStorageKey, isDisclosureKey } from './disclosure-keys.js';
export { FileChip, type FileChipProps, type FileChipState } from './FileChip.js';
export { Prose, type ProseProps } from './Prose.js';
export { StatusPill, type StatusPillProps } from './StatusPill.js';
export { Stepper, stepStatusText, type StepStatus, type StepperProps, type StepperStep } from './Stepper.js';
export { Surface, type SurfaceElevation, type SurfacePadding, type SurfaceProps, type SurfaceRadius, type SurfaceTone } from './Surface.js';
export { APPROVAL_STATE_LOOK, approvalStateLook, COMPONENT_STATE_LOOK, MAJOR_INCIDENT_LOOK, PRIORITY_LOOK, priorityLook, PROBLEM_STATE_LOOK, SLA_STATE_LOOK, STATUS_CATEGORY_LOOK, TICKET_STATE_LOOK, ticketStateLook, ticketTypeLook, TYPE_LOOK, type ApprovalStateKey, type ComponentStateKey, type PriorityKey, type PriorityLook, type ProblemStateKey, type SlaStateKey, type StateLook, type StatusCategoryKey, type TicketStateKey, type TicketTypeKey } from './ticket-states.js';
export { statusIcon, toneFromIntent } from './tone.js';
