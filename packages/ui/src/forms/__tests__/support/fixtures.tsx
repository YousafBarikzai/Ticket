import { useState, type ReactNode } from 'react';
import { FormRenderer, type UserOption } from '../../FormRenderer.js';
import type { FormDefinition, FormValues } from '../../schema.js';

export interface FormHarnessProps {
  readonly definition: FormDefinition;
  readonly initialValues?: FormValues;
  readonly context?: Record<string, unknown>;
  readonly loadUsers?: (query: string, signal: AbortSignal) => Promise<readonly UserOption[]>;
  readonly onValues?: (values: FormValues) => void;
}

export function FormHarness({ definition, initialValues = {}, context, loadUsers, onValues }: FormHarnessProps): ReactNode {
  const [values, setValues] = useState<FormValues>(initialValues);
  return (
    <FormRenderer
      definition={definition}
      values={values}
      context={context}
      loadUsers={loadUsers}
      onChange={(next) => {
        setValues(next);
        onValues?.(next);
      }}
    />
  );
}
