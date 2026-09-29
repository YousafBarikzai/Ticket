/**
 * Display and content: surfaces, pills, avatars, lists, disclosure, prose,
 * steppers, attachments and activity. Part of the root entry.
 *
 * `Card`, `Tile`, `Badge`, `Avatar`, `Table`, `Timeline` and `RichText` live in
 * `web/`, where the applications import them from today.
 */
export { ActivityFeed, type ActivityActor, type ActivityFeedProps, type ActivityItem } from './ActivityFeed.js';
export { AvatarStack, type AvatarStackPerson, type AvatarStackProps } from './AvatarStack.js';
export { DescriptionList, type DescriptionItem, type DescriptionListProps } from './DescriptionList.js';
export { Disclosure, type DisclosureProps } from './Disclosure.js';
export { FileChip, type FileChipProps } from './FileChip.js';
export { Prose, type ProseProps } from './Prose.js';
export { StatusPill, type StatusPillProps } from './StatusPill.js';
export { Stepper, type StepStatus, type StepperProps, type StepperStep } from './Stepper.js';
export { Surface, type SurfaceProps } from './Surface.js';
