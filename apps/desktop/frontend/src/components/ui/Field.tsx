import { useId, type ReactNode } from 'react';
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
};
export type FieldProps = {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  'aria-describedby'?: string;
  layout?: 'vertical' | 'horizontal';
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
};
export function Field({
  id: providedId,
  label,
  description,
  descriptionId,
  error,
  required,
  optional,
  'aria-describedby': external,
  layout = 'vertical',
  className = '',
  children,
}: FieldProps) {
  const generated = useId();
  const id = providedId ?? `field-${generated}`;
  const present = (value: ReactNode) =>
    value !== undefined && value !== null && value !== false && value !== '';
  const helpId = present(description) ? (descriptionId ?? `${id}-description`) : undefined;
  const errorId = present(error) ? `${id}-error` : undefined;
  const describedBy =
    Array.from(
      new Set([external, helpId, errorId].filter(Boolean).join(' ').split(/\s+/).filter(Boolean)),
    ).join(' ') || undefined;
  return (
    <div className={`sf-field ${className}`} data-layout={layout}>
      <div className="sf-field-label">
        <label htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
          {optional && !required && <span className="text-xs text-muted">（选填）</span>}
        </label>
        {helpId && (
          <div id={helpId} className="sf-field-help">
            {description}
          </div>
        )}
      </div>
      <div className="sf-field-control">
        {children({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': errorId ? true : undefined,
          required,
        })}
      </div>
      {errorId && (
        <p id={errorId} className="sf-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
