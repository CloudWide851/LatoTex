import type { AppContainerViewProps } from "./appContainerViewTypes";

type WorkspaceOnboardingSource = Pick<
  AppContainerViewProps,
  | "handleCreateSampleProject"
  | "handleOnboardingDismiss"
  | "handleOnboardingRestart"
  | "handleOnboardingRecordStep"
  | "handleProjectGoalSave"
  | "handleResearchDomainChange"
  | "handleResearchPrivacyReview"
  | "handlePdfViewed"
>;

export function buildWorkspaceOnboardingProps(props: WorkspaceOnboardingSource) {
  return {
    onCreateSample: props.handleCreateSampleProject,
    onOnboardingDismiss: props.handleOnboardingDismiss,
    onOnboardingRestart: props.handleOnboardingRestart,
    onOnboardingRecordStep: props.handleOnboardingRecordStep,
    onProjectGoalSave: props.handleProjectGoalSave,
    onResearchDomainChange: props.handleResearchDomainChange,
    onResearchPrivacyReview: props.handleResearchPrivacyReview,
    onPdfViewed: props.handlePdfViewed,
  };
}
