import {
  createContext,
  forwardRef,
  useContext,
  type AriaAttributes,
  type ComponentPropsWithoutRef,
} from 'react';

export type ControlSize = 'sm' | 'md' | 'lg';
type ControlOptions = { controlSize?: ControlSize; invalid?: boolean };
type ShellState = ControlOptions & { disabled?: boolean };
const InputShellContext = createContext<ShellState | null>(null);

export type InputProps = ComponentPropsWithoutRef<'input'> & ControlOptions;
export type TextareaProps = ComponentPropsWithoutRef<'textarea'> & ControlOptions;
export type SelectProps = ComponentPropsWithoutRef<'select'> & ControlOptions;
export type InputShellProps = ComponentPropsWithoutRef<'fieldset'> & ControlOptions;

function isInvalid(value: AriaAttributes['aria-invalid']) {
  return value !== undefined && value !== false && value !== 'false';
}

function useControl({
  controlSize,
  invalid,
  disabled,
  className,
  'aria-invalid': ariaInvalid,
}: ControlOptions & AriaAttributes & { disabled?: boolean; className?: string }) {
  const shell = useContext(InputShellContext);
  return {
    className: `sf-form-control ${shell ? 'sf-inner-input' : 'sf-input'} ${className ?? ''}`,
    'data-control-size': controlSize ?? shell?.controlSize ?? 'md',
    'data-in-shell': shell ? '' : undefined,
    'aria-invalid': invalid || shell?.invalid ? true : ariaInvalid,
    disabled: Boolean(disabled || shell?.disabled),
  };
}

/** Native attributes (including numeric size), events and refs pass through unchanged. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { controlSize, invalid, disabled, className, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const control = useControl({
    controlSize,
    invalid,
    disabled,
    className,
    'aria-invalid': ariaInvalid,
  });
  return <input {...props} {...control} ref={ref} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { controlSize, invalid, disabled, className, 'aria-invalid': ariaInvalid, rows = 3, ...props },
  ref,
) {
  const control = useControl({
    controlSize,
    invalid,
    disabled,
    className,
    'aria-invalid': ariaInvalid,
  });
  return <textarea {...props} {...control} rows={rows} ref={ref} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { controlSize, invalid, disabled, className, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const control = useControl({
    controlSize,
    invalid,
    disabled,
    className,
    'aria-invalid': ariaInvalid,
  });
  return <select {...props} {...control} ref={ref} />;
});

/** One focus boundary. Native fieldset also disables child action buttons without cloning them. */
export const InputShell = forwardRef<HTMLFieldSetElement, InputShellProps>(function InputShell(
  {
    controlSize = 'md',
    invalid,
    disabled,
    className,
    'aria-invalid': ariaInvalid,
    children,
    ...props
  },
  ref,
) {
  const parent = useContext(InputShellContext);
  const state = {
    controlSize,
    disabled: Boolean(disabled || parent?.disabled),
    invalid: Boolean(invalid || isInvalid(ariaInvalid) || parent?.invalid),
  };
  return (
    <InputShellContext.Provider value={state}>
      <fieldset
        {...props}
        ref={ref}
        disabled={state.disabled}
        aria-invalid={state.invalid ? true : ariaInvalid}
        data-control-size={controlSize}
        className={`sf-form-shell sf-input-shell ${className ?? ''}`}
      >
        {children}
      </fieldset>
    </InputShellContext.Provider>
  );
});
