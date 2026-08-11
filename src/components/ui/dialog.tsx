import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { cn } from "../../lib/utils";
import { cspStyle } from "../../shared/ui/cspStyle";
import { Button } from "./button";
import { Input } from "./input";
import { InfoHint } from "./info-hint";

export type AppDialogProps = {
  isOpen?: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  isDismissable?: boolean;
  overlayClassName?: string;
  modalClassName?: string;
  className?: string;
  children: ReactNode;
};

export function AppDialog(props: AppDialogProps) {
  const {
    isOpen = true,
    onClose,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    isDismissable = true,
    overlayClassName,
    modalClassName,
    className,
    children,
  } = props;

  return (
    <ModalOverlay
      isOpen={isOpen}
      isDismissable={isDismissable}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className={cn(
        "app-overlay-backdrop fixed inset-0 z-[430] flex items-center justify-center overflow-hidden p-4 motion-overlay-enter",
        overlayClassName,
      )}
    >
      <Modal className={cn("max-h-full w-full outline-none", modalClassName)}>
        <AriaDialog
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          className={cn("mx-auto max-h-full outline-none", className)}
        >
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type AppDialogTone = "default" | "danger" | "permission";

export function AppDialogFrame(props: {
  title: string;
  description?: string;
  tone?: AppDialogTone;
  onClose: () => void;
  isDismissable?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const {
    title,
    description,
    tone = "default",
    onClose,
    isDismissable = true,
    children,
    footer,
  } = props;
  const titleId = useId();
  const descriptionId = useId();

  return (
    <AppDialog
      onClose={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
      isDismissable={isDismissable}
      modalClassName="max-w-xl"
      className="app-material-floating overflow-hidden rounded-xl border border-[color:var(--editor-widget-border)] text-[color:var(--app-text)]"
    >
      <div
        className={cn(
          "h-1 w-full bg-[color:var(--app-accent)]",
          tone === "danger" && "bg-[color:var(--app-status-danger)]",
          tone === "permission" && "bg-[color:var(--app-status-warning)]",
        )}
        aria-hidden="true"
      />
      <div className="px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-start gap-1.5">
          <h2 id={titleId} className="min-w-0 text-base font-semibold leading-6 tracking-[-0.01em]">
            {title}
          </h2>
          {description ? (
            <InfoHint
              content={description}
              label={title}
              tone={tone === "default" ? "info" : "warning"}
              className="-mt-px"
            />
          ) : null}
        </div>
        {description ? (
          <p id={descriptionId} className="sr-only whitespace-pre-line">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-4 min-w-0">{children}</div> : null}
      </div>
      {footer ? (
        <footer className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--editor-widget-border)] px-5 py-3 sm:px-6">
          {footer}
        </footer>
      ) : null}
    </AppDialog>
  );
}

export function AppConfirmDialog(props: {
  title: string;
  description?: string;
  details?: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
  tone?: AppDialogTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    title,
    description,
    details = [],
    confirmLabel,
    cancelLabel,
    tone = "default",
    busy = false,
    onConfirm,
    onCancel,
  } = props;

  return (
    <AppDialogFrame
      title={title}
      description={description}
      tone={tone}
      onClose={onCancel}
      isDismissable={!busy}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone === "danger" ? "danger" : "default"} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {details.length > 0 ? (
        <ul className="library-scrollbar max-h-48 space-y-1 overflow-auto rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] p-3 text-xs leading-5">
          {details.map((detail, index) => <li key={`${index}:${detail}`} className="break-words">{detail}</li>)}
        </ul>
      ) : null}
    </AppDialogFrame>
  );
}

export function AppTextInputDialog(props: {
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  required?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const {
    title,
    description,
    label,
    initialValue = "",
    placeholder,
    confirmLabel,
    cancelLabel,
    required = false,
    onConfirm,
    onCancel,
  } = props;
  const [value, setValue] = useState(initialValue);
  const inputId = useId();
  const trimmedValue = value.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!required || trimmedValue) {
      onConfirm(trimmedValue);
    }
  };

  return (
    <AppDialogFrame
      title={title}
      description={description}
      onClose={onCancel}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button type="submit" form={`${inputId}-form`} disabled={required && !trimmedValue}>{confirmLabel}</Button>
        </>
      )}
    >
      <form id={`${inputId}-form`} onSubmit={submit}>
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-[color:var(--app-muted)]">
          {label}
        </label>
        <Input
          id={inputId}
          value={value}
          placeholder={placeholder}
          required={required}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
    </AppDialogFrame>
  );
}

export type AppDialogChoice = {
  id: string;
  label: string;
  description?: string;
  tone?: "default" | "danger";
};

function AppChoiceButton(props: {
  choice: AppDialogChoice;
  autoFocus: boolean;
  onChoose: (id: string) => void;
}) {
  const { choice, autoFocus, onChoose } = props;
  const descriptionId = useId();
  return (
    <div
      className={cn(
        "control-surface flex w-full items-center gap-2 px-3.5 py-2.5 transition-colors",
        "hover:border-[color:var(--app-accent)] focus-within:border-[color:var(--app-accent)] focus-within:ring-2 focus-within:ring-[color:var(--app-accent)]",
        choice.tone === "danger" && "text-[color:var(--app-status-danger)]",
      )}
    >
      <button
        type="button"
        autoFocus={autoFocus}
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
        aria-describedby={choice.description ? descriptionId : undefined}
        onClick={() => onChoose(choice.id)}
      >
        <strong className="block text-sm font-medium">{choice.label}</strong>
      </button>
      {choice.description ? (
        <>
          <InfoHint
            content={choice.description}
            label={choice.label}
            tone={choice.tone === "danger" ? "warning" : "info"}
          />
          <span id={descriptionId} className="sr-only">{choice.description}</span>
        </>
      ) : null}
      <span className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--app-accent)]" aria-hidden="true" />
    </div>
  );
}

export function AppChoiceDialog(props: {
  title: string;
  description?: string;
  choices: readonly AppDialogChoice[];
  cancelLabel?: string;
  tone?: AppDialogTone;
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
  const { title, description, choices, cancelLabel, tone = "permission", onChoose, onCancel } = props;
  return (
    <AppDialogFrame
      title={title}
      description={description}
      tone={tone}
      onClose={onCancel}
      footer={cancelLabel ? <Button type="button" variant="secondary" onClick={onCancel}>{cancelLabel}</Button> : undefined}
    >
      <div className="grid gap-2">
        {choices.map((choice, index) => (
          <AppChoiceButton
            key={choice.id}
            choice={choice}
            autoFocus={index === 0}
            onChoose={onChoose}
          />
        ))}
      </div>
    </AppDialogFrame>
  );
}

export const AppPermissionDialog = AppChoiceDialog;

export function AppInfoDialog(props: {
  title: string;
  description?: string;
  closeLabel: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  return (
    <AppDialogFrame
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      footer={<Button type="button" onClick={props.onClose} autoFocus>{props.closeLabel}</Button>}
    >
      {props.children}
    </AppDialogFrame>
  );
}

export function AppProgressDialog(props: {
  title: string;
  description?: string;
  progressLabel: string;
  progress: number;
  cancelLabel?: string;
  onCancel?: () => void;
}) {
  const progress = Math.max(0, Math.min(100, props.progress));
  return (
    <AppDialogFrame
      title={props.title}
      description={props.description}
      onClose={props.onCancel ?? (() => undefined)}
      isDismissable={Boolean(props.onCancel)}
      footer={props.cancelLabel && props.onCancel ? <Button type="button" variant="secondary" onClick={props.onCancel}>{props.cancelLabel}</Button> : undefined}
    >
      <div role="status" aria-label={props.progressLabel}>
        <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--editor-widget-border)]">
          <div
            className="h-full bg-[color:var(--app-accent)] transition-transform motion-reduce:transition-none"
            {...cspStyle({ transform: `scaleX(${progress / 100})`, transformOrigin: "left" })}
          />
        </div>
        <p className="mt-2 text-right text-xs tabular-nums text-[color:var(--app-muted)]">{props.progressLabel}</p>
      </div>
    </AppDialogFrame>
  );
}
