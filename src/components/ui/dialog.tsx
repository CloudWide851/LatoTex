import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { cn } from "../../lib/utils";

export type AppDialogProps = {
  isOpen?: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
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
          className={cn("mx-auto max-h-full outline-none", className)}
        >
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
