'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  announce,
  Badge,
  Button,
  DescriptionList,
  FormField,
  Icon,
  IconButton,
  InlineAlert,
  Input,
  notify,
  SegmentedControl,
  Select,
  Textarea,
} from '@itsm/ui';
import { Menu, type MenuItemSpec } from '@itsm/ui/overlays';
import { useTheme } from '@itsm/ui/theme';
import { ConditionBuilder } from '../ConditionBuilder.js';
import { JsonView } from '../JsonView.js';
import { FIELD_KEY, keyFor } from '../../keys.js';
import { describeCondition } from './describe.js';
import { OptionsEditor } from './OptionsEditor.js';
import {
  addBlock,
  answerFacts,
  blockName,
  duplicateQuestion,
  elementIdsOf,
  findBlock,
  hasOptions,
  insertAt,
  locate,
  moveBlock,
  moveToSection,
  newInstruction,
  newQuestion,
  newSection,
  QUESTION_TYPES,
  questionTypeInfo,
  removeBlock,
  sectionName,
  updateBlock,
  updateQuestion,
  type Block,
  type ChildBlock,
  type InstructionDraft,
  type Issue,
  type OpaqueDraft,
  type QuestionDraft,
  type QuestionsDraft,
  type QuestionType,
  type Requirement,
  type SectionDraft,
} from './questions.js';

/**
 * The questions editor (SPEC §6.1): the one list of questions used by the
 * request-type sheet (`layout="inline"`, each question opening in place)
 * and the full-page form editor (`layout="split"`, the question list beside
 * an inspector).
 *
 * - **Add** a question by type — short text, paragraph, dropdown,
 *   multi-select, checkbox, number, date, person — or a section or an
 *   instruction. It lands after the selected question and opens with its
 *   label focused. Click to add; there is no dragging (SPEC D5).
 * - **Reorder** with Move up / Move down in each row's ⋯ menu or with
 *   Alt+↑/↓ from anywhere in the row; focus stays where it was and the new
 *   place is announced. A question moves into and out of sections the same
 *   way, or with *Move to section*.
 * - **Edit** a question's label (its key follows until published), hint,
 *   type, options (with duplicate warnings), *Required* (never, always, or
 *   when other answers say so) and *Show when*, both with the condition
 *   builder over the form's other questions.
 * - **Remove** with *Undo* in the toast. Removing a section keeps its
 *   questions.
 *
 * Problems found by `checkQuestions` are shown on the question they belong
 * to, and the parent decides whether saving is allowed.
 */
export interface QuestionsEditorProps {
  readonly draft: QuestionsDraft;
  /** Client only. */
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly layout: 'inline' | 'split';
  readonly readOnly?: boolean;
  readonly issues?: readonly Issue[];
  /** The open question, when the parent holds it (the full-page editor). */
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  /** Shown in the inspector when nothing is selected (split layout): the form's own details. */
  readonly idle?: ReactNode;
  /** The list's name: "Questions". */
  readonly label?: string;
  readonly headingLevel?: 3 | 4;
}

type Focus = { readonly id: string; readonly control: string };

export function QuestionsEditor({
  draft,
  onChange,
  layout,
  readOnly = false,
  issues = [],
  selectedId: controlledSelected,
  onSelect,
  idle,
  label = 'Questions',
  headingLevel = 3,
}: QuestionsEditorProps): ReactNode {
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selectedId = controlledSelected !== undefined ? controlledSelected : ownSelected;
  const select = (id: string | null): void => {
    if (controlledSelected === undefined) setOwnSelected(id);
    onSelect?.(id);
  };
  const latest = useRef(draft);
  latest.current = draft;
  const root = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  // Where a menu hands focus back when it closes: its trigger, unless one of
  // its items moved focus on purpose (a new question's label, a copy).
  const closeTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focus) return;
    const scope = root.current;
    const target =
      scope?.querySelector<HTMLElement>(`[data-block="${focus.id}"] [data-control="${focus.control}"]`) ??
      scope?.querySelector<HTMLElement>(`[data-inspector="${focus.id}"] [data-control="${focus.control}"]`) ??
      scope?.querySelector<HTMLElement>(`[data-block="${focus.id}"] [data-control="open"]`);
    if (target) {
      closeTo.current = target;
      target.focus();
    }
    if (focus.control === 'label' && layout === 'split') inspectorRef.current?.scrollIntoView?.({ block: 'nearest' });
    setFocus(null);
  }, [focus, draft, selectedId, layout]);

  const issuesFor = (id: string): Issue[] => issues.filter((issue) => issue.blockId === id);
  const sections = draft.blocks.filter((block): block is SectionDraft => block.kind === 'section');

  const add = (block: Block): void => {
    const next = addBlock(draft, block, { afterId: selectedId });
    onChange(next);
    select(block.id);
    setFocus({ id: block.id, control: block.kind === 'section' ? 'title' : block.kind === 'instruction' ? 'text' : 'label' });
    announce(`${block.kind === 'section' ? 'Section' : block.kind === 'instruction' ? 'Instruction' : 'Question'} added`);
  };

  const move = (id: string, direction: 'up' | 'down', control = 'open'): void => {
    const moved = moveBlock(draft, id, direction);
    if (!moved) return;
    onChange(moved.draft);
    const block = findBlock(moved.draft, id);
    announce(`${block ? blockName(block) : 'Question'} moved to ${moved.where}`);
    setFocus({ id, control });
  };

  const remove = (id: string): void => {
    const found = locate(draft, id);
    if (!found) return;
    const block = found.block;
    const next = removeBlock(draft, id);
    onChange(next);
    if (selectedId === id) select(null);
    const siblings = found.section ? found.section.children : draft.blocks;
    const neighbour = siblings[found.index + 1] ?? siblings[found.index - 1] ?? found.section;
    if (neighbour) setFocus({ id: neighbour.id, control: 'open' });
    if (block.kind === 'section') {
      notify(`Section removed${block.children.length > 0 ? '. Its questions stay in the form.' : ''}`);
      return;
    }
    const sectionId = found.section?.id ?? null;
    const index = found.index;
    notify(`${blockName(block)} removed`, {
      undo: async () => {
        onChange(insertAt(latest.current, block as ChildBlock, sectionId, index));
        select(block.id);
      },
    });
  };

  const duplicate = (id: string): void => {
    const result = duplicateQuestion(draft, id);
    if (!result.copyId) return;
    onChange(result.draft);
    select(result.copyId);
    setFocus({ id: result.copyId, control: 'label' });
    announce('Question duplicated');
  };

  const toSection = (block: Block, section: SectionDraft | null): void => {
    onChange(moveToSection(draft, block.id, section?.id ?? null));
    announce(`${blockName(block)} moved ${section ? `to the end of ${sectionName(section)}` : 'out of its section'}`);
    setFocus({ id: block.id, control: 'menu' });
  };

  const menuFor = (block: Block, first: boolean, last: boolean, section: SectionDraft | null): MenuItemSpec[] => {
    const items: MenuItemSpec[] = [
      { id: 'up', label: 'Move up', icon: 'arrow-up', shortcut: 'alt+up', disabled: first, onSelect: () => move(block.id, 'up') },
      { id: 'down', label: 'Move down', icon: 'arrow-down', shortcut: 'alt+down', disabled: last, onSelect: () => move(block.id, 'down') },
    ];
    if (block.kind !== 'section' && (sections.length > 0 || section)) {
      items.push({
        type: 'submenu',
        id: 'section',
        label: 'Move to section',
        icon: 'rows-3',
        items: [
          ...(section ? [{ id: 'none', label: 'Out of the section', onSelect: () => toSection(block, null) }] : []),
          ...sections.filter((entry) => entry.id !== section?.id).map((entry) => ({ id: entry.id, label: blockName(entry), onSelect: () => toSection(block, entry) })),
        ],
      });
    }
    if (block.kind === 'question') items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(block.id) });
    items.push({ type: 'separator' });
    items.push({ id: 'remove', label: block.kind === 'section' ? 'Remove section' : 'Remove', icon: 'trash', tone: 'danger', onSelect: () => remove(block.id) });
    return items;
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, id: string): void => {
    if (readOnly || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    // Only the row's own header: a question's options and conditions have their own Alt+arrows.
    if ((event.target as HTMLElement).closest('[data-inspector]')) return;
    event.preventDefault();
    event.stopPropagation();
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')?.dataset.control ?? 'open';
    move(id, event.key === 'ArrowUp' ? 'up' : 'down', control);
  };

  const selected = selectedId ? findBlock(draft, selectedId) : null;
  const questionCount = draft.blocks.reduce((count, block) => count + (block.kind === 'section' ? block.children.length : 1), 0);

  const renderRow = (block: Block, index: number): ReactNode => {
    const first = index === 0;
    const last = index === draft.blocks.length - 1;
    const open = selectedId === block.id;
    return (
      <li
        key={block.id}
        className="app-Question"
        data-block={block.id}
        data-kind={block.kind}
        data-selected={open ? '' : undefined}
        onKeyDown={(event) => onRowKeyDown(event, block.id)}
      >
        <BlockHeader
          block={block}
          index={index}
          open={open}
          layout={layout}
          readOnly={readOnly}
          issues={issuesFor(block.id)}
          facts={answerFacts(draft, block.id)}
          onToggle={() => select(open && layout === 'inline' ? null : block.id)}
          menu={readOnly ? null : menuFor(block, first, last, null)}
          canMoveUp={!first}
          canMoveDown={!last}
          onMove={(direction) => move(block.id, direction, direction)}
          closeTo={closeTo}
        />
        {layout === 'inline' && open ? (
          <div className="app-Question__inspector" data-inspector={block.id}>
            <Inspector block={block} draft={draft} onChange={onChange} readOnly={readOnly} issues={issuesFor(block.id)} headingLevel={headingLevel} />
          </div>
        ) : null}
        {block.kind === 'section' ? (
          block.children.length === 0 ? (
            <p className="app-Question__emptySection">No questions in this section yet. Move one in, or select the section and add one.</p>
          ) : (
            <ol className="app-Questions__nested" aria-label={`${blockName(block)}, ${block.children.length} ${block.children.length === 1 ? 'item' : 'items'}`}>
              {block.children.map((child, childIndex) => renderChild(child, childIndex, block))}
            </ol>
          )
        ) : null}
      </li>
    );
  };

  const renderChild = (child: ChildBlock, index: number, section: SectionDraft): ReactNode => {
    const open = selectedId === child.id;
    // A question in a section can always move: past the heading or past the end, it leaves the section.
    return (
      <li
        key={child.id}
        className="app-Question"
        data-block={child.id}
        data-kind={child.kind}
        data-selected={open ? '' : undefined}
        onKeyDown={(event) => onRowKeyDown(event, child.id)}
      >
        <BlockHeader
          block={child}
          index={index}
          open={open}
          layout={layout}
          readOnly={readOnly}
          issues={issuesFor(child.id)}
          facts={answerFacts(draft, child.id)}
          onToggle={() => select(open && layout === 'inline' ? null : child.id)}
          menu={readOnly ? null : menuFor(child, false, false, section)}
          canMoveUp
          canMoveDown
          onMove={(direction) => move(child.id, direction, direction)}
          closeTo={closeTo}
        />
        {layout === 'inline' && open ? (
          <div className="app-Question__inspector" data-inspector={child.id}>
            <Inspector block={child} draft={draft} onChange={onChange} readOnly={readOnly} issues={issuesFor(child.id)} headingLevel={headingLevel} />
          </div>
        ) : null}
      </li>
    );
  };

  const list = (
    <div className="app-Questions__main">
      {draft.blocks.length === 0 ? (
        <div className="app-Questions__empty">
          <Icon name="forms" size="lg" />
          <p>
            <strong>No questions yet.</strong> Requesters will be asked for a title and a description only.
            {readOnly ? '' : ' Add the first question below.'}
          </p>
        </div>
      ) : (
        <ol className="app-Questions__list" aria-label={`${label}, ${questionCount} ${questionCount === 1 ? 'item' : 'items'}`}>
          {draft.blocks.map((block, index) => renderRow(block, index))}
        </ol>
      )}
      {readOnly ? null : <AddMenu draft={draft} onAdd={add} afterLabel={selected ? blockName(selected) : null} closeTo={closeTo} />}
    </div>
  );

  if (layout === 'inline') {
    return (
      <div className="app-Questions" data-layout="inline" ref={root}>
        {list}
      </div>
    );
  }

  return (
    <div className="app-Questions" data-layout="split" ref={root}>
      {list}
      <aside className="app-Questions__aside" aria-label={selected ? `Inspector: ${blockName(selected)}` : 'Inspector'} ref={inspectorRef}>
        {selected ? (
          <div data-inspector={selected.id}>
            <Inspector block={selected} draft={draft} onChange={onChange} readOnly={readOnly} issues={issuesFor(selected.id)} headingLevel={headingLevel} showTitle />
          </div>
        ) : (
          (idle ?? <p className="app-Questions__idle">Select a question to change it.</p>)
        )}
      </aside>
    </div>
  );
}

/* =========================================================================
 * A row's header
 * ====================================================================== */

function BlockHeader({
  block,
  index,
  open,
  layout,
  readOnly,
  issues,
  facts,
  onToggle,
  menu,
  canMoveUp,
  canMoveDown,
  onMove,
  closeTo,
}: {
  readonly block: Block;
  readonly index: number;
  readonly open: boolean;
  readonly layout: 'inline' | 'split';
  readonly readOnly: boolean;
  readonly issues: readonly Issue[];
  readonly facts: ReturnType<typeof answerFacts>;
  readonly onToggle: () => void;
  readonly menu: MenuItemSpec[] | null;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMove: (direction: 'up' | 'down') => void;
  readonly closeTo: { current: HTMLElement | null };
}): ReactNode {
  const { prefs } = useTheme();
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const name = blockName(block, index);
  const icon = block.kind === 'question' ? questionTypeInfo(block.type).icon : block.kind === 'section' ? 'rows-3' : block.kind === 'instruction' ? 'info' : 'lock';
  const typeLabel = block.kind === 'question' ? questionTypeInfo(block.type).label : block.kind === 'section' ? 'Section' : block.kind === 'instruction' ? 'Instruction' : 'Kept as written';
  const chips: { id: string; label: string; tone?: 'warning' | 'neutral' | 'danger' }[] = [];
  if (block.kind === 'question') {
    if (block.required === 'always') chips.push({ id: 'required', label: 'Required' });
    if (block.required === 'when') chips.push({ id: 'required', label: `Required when ${describeCondition(block.requiredWhen, facts)}` });
  }
  if ((block.kind === 'question' || block.kind === 'section' || block.kind === 'instruction') && block.visibleWhen) {
    chips.push({ id: 'shown', label: `Shown when ${describeCondition(block.visibleWhen, facts)}` });
  }
  if (issues.length > 0) chips.push({ id: 'issues', label: issues.length === 1 ? '1 problem' : `${issues.length} problems`, tone: 'danger' });
  const summary = block.kind === 'instruction' ? (block.editable ? block.text.split('\n')[0] : 'Formatted text, kept as written') : null;

  return (
    <div className="app-Question__head" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="app-Question__open"
        data-control="open"
        {...(layout === 'inline' ? { 'aria-expanded': open } : { 'aria-pressed': open })}
        onClick={onToggle}
      >
        <span className="app-Question__icon" aria-hidden="true">
          <Icon name={icon} size="sm" />
        </span>
        <span className="app-Question__text">
          <span className="app-Question__name">
            <span className="itsm-visually-hidden">{typeLabel}: </span>
            {name}
          </span>
          <span className="app-Question__meta">
            <span aria-hidden="true">{typeLabel}</span>
            {summary ? <span className="app-Question__summary">{summary}</span> : null}
            {block.kind === 'question' && prefs.showKeys && block.field ? <code className="app-Question__key">{block.field}</code> : null}
          </span>
        </span>
      </button>
      {chips.length > 0 ? (
        <span className="app-Question__chips">
          {chips.map((chip) => (
            <Badge key={chip.id} size="sm" tone={chip.tone ?? 'neutral'}>
              {chip.label}
            </Badge>
          ))}
        </span>
      ) : null}
      {menu ? (
        <span className="app-Question__actions">
          <IconButton
            icon="arrow-up"
            label={`Move ${name} up`}
            size="sm"
            data-control="up"
            aria-keyshortcuts="Alt+ArrowUp"
            disabled={!canMoveUp}
            onClick={() => onMove('up')}
          />
          <IconButton
            icon="arrow-down"
            label={`Move ${name} down`}
            size="sm"
            data-control="down"
            aria-keyshortcuts="Alt+ArrowDown"
            disabled={!canMoveDown}
            onClick={() => onMove('down')}
          />
          <Menu
            trigger={<IconButton ref={menuTrigger} icon="ellipsis" label={`More actions for ${name}`} size="sm" data-control="menu" />}
            items={menu}
            label={`Actions for ${name}`}
            onCloseFocus={closeTo}
            onOpenChange={(open) => {
              if (open) closeTo.current = menuTrigger.current;
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/* =========================================================================
 * Adding
 * ====================================================================== */

function AddMenu({
  draft,
  onAdd,
  afterLabel,
  closeTo,
}: {
  readonly draft: QuestionsDraft;
  readonly onAdd: (block: Block) => void;
  readonly afterLabel: string | null;
  readonly closeTo: { current: HTMLElement | null };
}): ReactNode {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const items: MenuItemSpec[] = [
    { type: 'label', label: 'Question' },
    ...QUESTION_TYPES.map((info) => ({
      id: info.type,
      label: info.label,
      icon: info.icon,
      description: info.description,
      onSelect: () => onAdd(newQuestion(info.type)),
    })),
    { type: 'separator' },
    { id: 'section', label: 'Section', icon: 'rows-3', description: 'A heading that groups questions: a step in the portal.', onSelect: () => onAdd(newSection(elementIdsOf(draft))) },
    { id: 'instruction', label: 'Instruction', icon: 'info', description: 'A few words of guidance between questions.', onSelect: () => onAdd(newInstruction(elementIdsOf(draft))) },
  ];
  return (
    <div className="app-Questions__add">
      <Menu
        trigger={
          <Button ref={trigger} variant="secondary" size="sm" iconStart="plus" iconEnd="chevron-down" data-control="add">
            Add question
          </Button>
        }
        items={items}
        label="Add to the form"
        align="start"
        onCloseFocus={closeTo}
        onOpenChange={(open) => {
          if (open) closeTo.current = trigger.current;
        }}
      />
      {afterLabel ? <span className="app-Questions__addHint">Adds after “{afterLabel}”</span> : null}
    </div>
  );
}

/* =========================================================================
 * The inspector
 * ====================================================================== */

function Inspector({
  block,
  draft,
  onChange,
  readOnly,
  issues,
  headingLevel,
  showTitle = false,
}: {
  readonly block: Block;
  readonly draft: QuestionsDraft;
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly readOnly: boolean;
  readonly issues: readonly Issue[];
  readonly headingLevel: 3 | 4;
  readonly showTitle?: boolean;
}): ReactNode {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const title = block.kind === 'question' ? 'Question' : block.kind === 'section' ? 'Section' : block.kind === 'instruction' ? 'Instruction' : 'Kept as written';
  return (
    <div className="app-Inspector">
      {showTitle ? <Heading className="app-Inspector__title">{title}</Heading> : null}
      {block.kind === 'question' ? <QuestionInspector question={block} draft={draft} onChange={onChange} readOnly={readOnly} issues={issues} /> : null}
      {block.kind === 'section' ? <SectionInspector section={block} draft={draft} onChange={onChange} readOnly={readOnly} issues={issues} /> : null}
      {block.kind === 'instruction' ? <InstructionInspector instruction={block} draft={draft} onChange={onChange} readOnly={readOnly} issues={issues} /> : null}
      {block.kind === 'opaque' ? <KeptInspector block={block} /> : null}
    </div>
  );
}

const issueOf = (issues: readonly Issue[], field: Issue['field']): string | undefined => issues.find((issue) => issue.field === field)?.message;

function QuestionInspector({
  question,
  draft,
  onChange,
  readOnly,
  issues,
}: {
  readonly question: QuestionDraft;
  readonly draft: QuestionsDraft;
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly readOnly: boolean;
  readonly issues: readonly Issue[];
}): ReactNode {
  const { prefs } = useTheme();
  const facts = useMemo(() => answerFacts(draft, question.id), [draft, question.id]);
  const set = (patch: Partial<Omit<QuestionDraft, 'kind' | 'id'>>): void => onChange(updateQuestion(draft, question.id, patch));
  const kept = Object.keys(question.keep.element).length + Object.keys(question.keep.property).filter((key) => key !== 'description').length;
  const [showWhen, setShowWhen] = useState(question.visibleWhen ? 'when' : 'always');

  if (readOnly) {
    return (
      <DescriptionList
        layout="stacked"
        items={[
          { id: 'label', label: 'Label', value: question.label || '—' },
          { id: 'type', label: 'Type', value: questionTypeInfo(question.type).label },
          ...(question.hint ? [{ id: 'hint', label: 'Hint', value: question.hint }] : []),
          ...(hasOptions(question.type) ? [{ id: 'options', label: 'Options', value: question.options.map((option) => option.label).join(', ') || '—' }] : []),
          {
            id: 'required',
            label: 'Required',
            value: question.required === 'always' ? 'Always' : question.required === 'when' ? `When ${describeCondition(question.requiredWhen, facts)}` : 'No',
          },
          { id: 'shown', label: 'Shown', value: question.visibleWhen ? `When ${describeCondition(question.visibleWhen, facts)}` : 'Always' },
        ]}
      />
    );
  }

  return (
    <div className="app-Inspector__fields">
      <FormField label="Label" required {...(issueOf(issues, 'label') ? { error: issueOf(issues, 'label')! } : {})} hint="What the requester reads, like “Which system?”.">
        <Input data-control="label" value={question.label} placeholder="Question" autoComplete="off" onChange={(event) => set({ label: event.currentTarget.value })} />
      </FormField>
      <QuestionKey question={question} draft={draft} onChange={onChange} error={issueOf(issues, 'key')} showKeys={prefs.showKeys} />
      <FormField label="Type">
        <Select
          data-control="type"
          value={question.type}
          options={QUESTION_TYPES.map((info) => ({ value: info.type, label: info.label }))}
          onChange={(event) => set({ type: event.currentTarget.value as QuestionType })}
        />
      </FormField>
      <FormField label="Hint" optional hint="A line under the question, for anything that helps answer it.">
        <Textarea data-control="hint" rows={2} value={question.hint} onChange={(event) => set({ hint: event.currentTarget.value })} />
      </FormField>
      {hasOptions(question.type) ? (
        <fieldset className="app-Inspector__group">
          <legend>Options</legend>
          <OptionsEditor
            label={`Options for ${question.label || 'this question'}`}
            options={question.options}
            showValues={prefs.showKeys}
            onChange={(options) => set({ options })}
            {...(issueOf(issues, 'options') ? { error: issueOf(issues, 'options')! } : {})}
          />
        </fieldset>
      ) : null}
      <fieldset className="app-Inspector__group">
        <legend>Required</legend>
        <SegmentedControl
          label="Required"
          mode="value"
          size="sm"
          value={question.required}
          onValueChange={(value) => set({ required: value as Requirement, ...(value === 'when' && !question.requiredWhen ? { requiredWhen: null } : {}) })}
          options={[
            { value: 'never', label: 'No' },
            { value: 'always', label: 'Always' },
            ...(facts.length > 0 || question.required === 'when' ? [{ value: 'when', label: 'When…' }] : []),
          ]}
        />
        {question.required === 'when' ? (
          <ConditionBuilder
            label="Required when"
            value={question.requiredWhen ?? undefined}
            factCatalogue={facts}
            emptyText="Never"
            onChange={(expression) => set({ requiredWhen: expression })}
          />
        ) : null}
        {issueOf(issues, 'requiredWhen') ? <p className="app-FieldError">{issueOf(issues, 'requiredWhen')}</p> : null}
      </fieldset>
      <fieldset className="app-Inspector__group">
        <legend>Show</legend>
        {facts.length > 0 || question.visibleWhen ? (
        <SegmentedControl
          label="Show this question"
          mode="value"
          size="sm"
          value={question.visibleWhen ? 'when' : showWhen}
          onValueChange={(value) => {
            setShowWhen(value);
            if (value === 'always') set({ visibleWhen: null });
          }}
          options={[
            { value: 'always', label: 'Always' },
            { value: 'when', label: 'Only when…' },
          ]}
        />
        ) : null}
        {question.visibleWhen || showWhen === 'when' ? (
          <ConditionBuilder
            label="Show when"
            value={question.visibleWhen ?? undefined}
            factCatalogue={facts}
            emptyText="Always shown"
            onChange={(expression) => set({ visibleWhen: isEmptyCondition(expression) ? null : expression })}
          />
        ) : null}
        {facts.length === 0 && !question.visibleWhen ? (
          <p className="app-Inspector__note">Always shown. To show it only for some answers, add a dropdown, checkbox, number or short-text question for it to depend on.</p>
        ) : null}
        {issueOf(issues, 'visibleWhen') ? <p className="app-FieldError">{issueOf(issues, 'visibleWhen')}</p> : null}
      </fieldset>
      {kept > 0 ? (
        <InlineAlert tone="info">Some settings of this question were made outside the builder, such as a length limit. They’re kept as they are.</InlineAlert>
      ) : null}
    </div>
  );
}

function isEmptyCondition(expression: unknown): boolean {
  return typeof expression === 'object' && expression !== null && (expression as { always?: unknown }).always === true;
}

/**
 * The answer's key: follows the label ("Access level" → `accessLevel`) until
 * edited by hand, and fixed once people have answered it. Written here
 * rather than with `KeyField` because a question's key has to remember
 * "edited by hand" across the inspector closing and opening again.
 */
function QuestionKey({
  question,
  draft,
  onChange,
  error,
  showKeys,
}: {
  readonly question: QuestionDraft;
  readonly draft: QuestionsDraft;
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly error: string | undefined;
  readonly showKeys: boolean;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const inputId = useId();
  const state = question.keyLocked ? 'locked' : !question.field ? 'empty' : FIELD_KEY.test(question.field) && !error ? 'ok' : 'invalid';
  // Most people never need to see the key; it is shown when it needs attention, or on request.
  if (!showKeys && !editing && state === 'ok') return null;
  const message =
    state === 'locked'
      ? 'published, so it can’t change: answers are stored under it'
      : state === 'empty'
        ? question.label.trim()
          ? 'can’t be made from this label — edit the key by hand'
          : 'appears when you type a label'
        : state === 'ok'
          ? question.autoKey
            ? 'follows the label until the form is published'
            : 'set by hand'
          : (error ?? 'isn’t a valid key');

  return (
    <div className="app-KeyField" data-state={state === 'locked' ? 'locked' : state === 'ok' ? 'ok' : 'invalid'}>
      <p className="app-KeyField__line">
        <span className="app-KeyField__label">Key</span> {question.field ? <code className="app-KeyField__key">{question.field}</code> : <span className="app-KeyField__none">—</span>}{' '}
        <span className="app-KeyField__state" aria-live="polite">
          · {message}
        </span>
        {question.keyLocked || editing ? null : (
          <Button variant="ghost" size="sm" className="app-KeyField__edit" onClick={() => setEditing(true)}>
            Edit key
          </Button>
        )}
      </p>
      {editing && !question.keyLocked ? (
        <div className="app-KeyField__editor">
          <FormField label="Key" id={inputId} hint="Letters and numbers, starting with a lower-case letter; up to 64 characters." {...(state === 'invalid' && error ? { error } : {})}>
            <Input
              autoFocus
              value={question.field}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => onChange(updateQuestion(draft, question.id, { field: event.currentTarget.value.trim(), autoKey: false }))}
            />
          </FormField>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(updateQuestion(draft, question.id, { field: keyFor(question.label), autoKey: true }));
              setEditing(false);
            }}
          >
            Use the key from the label
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SectionInspector({
  section,
  draft,
  onChange,
  readOnly,
  issues,
}: {
  readonly section: SectionDraft;
  readonly draft: QuestionsDraft;
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly readOnly: boolean;
  readonly issues: readonly Issue[];
}): ReactNode {
  const facts = useMemo(() => answerFacts(draft), [draft]);
  const set = (patch: Partial<SectionDraft>): void => onChange(updateBlock(draft, section.id, (block) => (block.kind === 'section' ? { ...block, ...patch } : block)));
  if (readOnly) {
    return (
      <DescriptionList
        layout="stacked"
        items={[
          { id: 'title', label: 'Title', value: section.title || '—' },
          ...(section.description ? [{ id: 'description', label: 'Description', value: section.description }] : []),
          { id: 'shown', label: 'Shown', value: section.visibleWhen ? `When ${describeCondition(section.visibleWhen, facts)}` : 'Always' },
        ]}
      />
    );
  }
  return (
    <div className="app-Inspector__fields">
      <p className="app-Inspector__note">In the portal each section is a step, with the questions outside sections first.</p>
      <FormField label="Title" required {...(issueOf(issues, 'title') ? { error: issueOf(issues, 'title')! } : {})}>
        <Input data-control="title" value={section.title} placeholder="Like “Your laptop”" onChange={(event) => set({ title: event.currentTarget.value })} />
      </FormField>
      <FormField label="Description" optional>
        <Textarea rows={2} value={section.description} onChange={(event) => set({ description: event.currentTarget.value })} />
      </FormField>
      {facts.length > 0 || section.visibleWhen ? (
        <ConditionBuilder
          label="Show this section when"
          value={section.visibleWhen ?? undefined}
          factCatalogue={facts}
          emptyText="Always shown"
          onChange={(expression) => set({ visibleWhen: isEmptyCondition(expression) ? null : expression })}
        />
      ) : null}
      {issueOf(issues, 'visibleWhen') ? <p className="app-FieldError">{issueOf(issues, 'visibleWhen')}</p> : null}
    </div>
  );
}

function InstructionInspector({
  instruction,
  draft,
  onChange,
  readOnly,
  issues,
}: {
  readonly instruction: InstructionDraft;
  readonly draft: QuestionsDraft;
  readonly onChange: (draft: QuestionsDraft) => void;
  readonly readOnly: boolean;
  readonly issues: readonly Issue[];
}): ReactNode {
  const facts = useMemo(() => answerFacts(draft), [draft]);
  const set = (patch: Partial<InstructionDraft>): void => onChange(updateBlock(draft, instruction.id, (block) => (block.kind === 'instruction' ? { ...block, ...patch } : block)));
  if (!instruction.editable) {
    return (
      <div className="app-Inspector__fields">
        <InlineAlert tone="info">This instruction has formatting the builder can’t write, so it’s shown as it is and saved unchanged.</InlineAlert>
        <JsonView value={instruction.content} label="Instruction content" />
      </div>
    );
  }
  return (
    <div className="app-Inspector__fields">
      <FormField label="Text" required hint="A blank line starts a new paragraph." {...(issueOf(issues, 'text') ? { error: issueOf(issues, 'text')! } : {})}>
        <Textarea data-control="text" rows={4} readOnly={readOnly} value={instruction.text} onChange={(event) => set({ text: event.currentTarget.value })} />
      </FormField>
      {!readOnly && (facts.length > 0 || instruction.visibleWhen) ? (
        <ConditionBuilder
          label="Show this instruction when"
          value={instruction.visibleWhen ?? undefined}
          factCatalogue={facts}
          emptyText="Always shown"
          onChange={(expression) => set({ visibleWhen: isEmptyCondition(expression) ? null : expression })}
        />
      ) : null}
    </div>
  );
}

function KeptInspector({ block }: { readonly block: OpaqueDraft }): ReactNode {
  return (
    <div className="app-Inspector__fields">
      <InlineAlert tone="info">This part of the form was written outside the builder — a section inside a section — so it’s shown as it is and saved unchanged.</InlineAlert>
      <JsonView value={block.element} label="Kept element" />
    </div>
  );
}
