/**
 * `@itsm/ui/overlays` — everything that floats above the page.
 *
 * Kept off the root entry because the overlays are where the heavy
 * dependencies live (the Radix primitives and the toast library): a page that
 * opens no menu, sheet or dialog should not download them, and a separate
 * subpath is what guarantees that rather than hoping a bundler notices.
 * `notify()` itself is in the root; only the `Toaster` that shows it is here.
 */
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog.js';
export { ConflictDialog, type ConflictChange, type ConflictDialogProps } from './ConflictDialog.js';
export { ContextMenu, type ContextMenuProps } from './ContextMenu.js';
export { DateRangePicker, type DatePreset, type DateRange, type DateRangePickerProps } from './DateRangePicker.js';
export { Menu, type MenuItemSpec, type MenuProps } from './Menu.js';
export { PersonPicker, type Availability, type PersonOption, type PersonPickerProps } from './PersonPicker.js';
export { Popover, type PopoverProps } from './Popover.js';
export { Sheet, type SheetCloseReason, type SheetProps } from './Sheet.js';
export { SplitButton, type SplitButtonProps } from './SplitButton.js';
export { Toaster, type ToasterProps } from './Toaster.js';

// The in-house components, rebuilt in place on the Radix primitives.
export { Combobox, type ComboboxOption, type ComboboxProps } from '../web/Combobox.js';
export { DatePicker, formatIsoDate, parseIsoDate, type DatePickerProps } from '../web/DatePicker.js';
export { Dialog, type DialogCloseReason, type DialogProps } from '../web/Dialog.js';
export { Tooltip, type TooltipProps } from '../web/Tooltip.js';
// Deprecated: superseded by the `Toaster` and `notify()`, kept while apps move across.
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastIntent,
  type ToastOptions,
  type ToastProviderProps,
} from '../web/Toast.js';
