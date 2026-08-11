import { InfoHint, type InfoHintTone } from "./info-hint";

export function HelpTooltip(props: {
  content: string;
  label?: string;
  tone?: InfoHintTone;
  className?: string;
}) {
  return <InfoHint {...props} />;
}
