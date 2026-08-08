import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import {
  AppChoiceDialog,
  AppConfirmDialog,
  AppTextInputDialog,
} from "../../components/ui/dialog";
import {
  registerAppDialogHost,
  type AppDialogBridgeEntry,
} from "./appDialogBridge";

export function AppDialogHost() {
  const { t } = useI18n();
  const [entry, setEntry] = useState<AppDialogBridgeEntry | null>(null);

  useEffect(() => registerAppDialogHost(setEntry), []);

  if (!entry) {
    return null;
  }

  const { request } = entry;
  if (request.kind === "confirm") {
    return (
      <AppConfirmDialog
        title={request.title}
        description={request.description}
        details={request.details}
        confirmLabel={request.confirmLabel ?? t("common.confirm")}
        cancelLabel={request.cancelLabel ?? t("common.cancel")}
        tone={request.tone}
        onConfirm={() => entry.settle(true)}
        onCancel={() => entry.settle(false)}
      />
    );
  }

  if (request.kind === "text-input") {
    return (
      <AppTextInputDialog
        key={entry.id}
        title={request.title}
        description={request.description}
        label={request.label}
        initialValue={request.initialValue}
        placeholder={request.placeholder}
        required={request.required}
        confirmLabel={request.confirmLabel ?? t("common.confirm")}
        cancelLabel={request.cancelLabel ?? t("common.cancel")}
        onConfirm={(value) => entry.settle(value)}
        onCancel={() => entry.settle(null)}
      />
    );
  }

  return (
    <AppChoiceDialog
      title={request.title}
      description={request.description}
      choices={request.choices}
      cancelLabel={request.cancelLabel ?? t("common.cancel")}
      tone={request.tone}
      onChoose={(choice) => entry.settle(choice)}
      onCancel={() => entry.settle(null)}
    />
  );
}
