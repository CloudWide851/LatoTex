import type {
  Ack,
  DingTalkPollInput,
  DingTalkPollResult,
  DingTalkSendInput,
  DingTalkTestInput,
  EmailFetchSubmissionInput,
  EmailFetchSubmissionResult,
  EmailPasswordSaveInput,
  ShareOwnerAuth,
  ShareSessionCreateResult,
  ShareSessionInfo,
  ShareSessionPasswordResult,
  TelegramPollInput,
  TelegramPollResult,
  TelegramConnectionResult,
  TelegramTestInput,
  TelegramTokenSaveInput,
} from "../types/app";
import { invokeCommand } from "./core";

export function shareSessionCreate(
  projectId: string,
  targetPath: string,
  mode: "local" | "remote" = "remote",
  sessionName?: string,
): Promise<ShareSessionCreateResult> {
  return invokeCommand<ShareSessionCreateResult>("share_session_create", {
    input: { projectId, targetPath, mode, sessionName },
  });
}

export function shareSessionStatus(): Promise<ShareSessionInfo> {
  return invokeCommand<ShareSessionInfo>("share_session_status");
}

export function shareSessionOwnerAuth(sessionId: string, username?: string): Promise<ShareOwnerAuth> {
  return invokeCommand<ShareOwnerAuth>("share_session_owner_auth", {
    input: { sessionId, username },
  });
}

export function shareSessionPasswordReveal(sessionId: string): Promise<ShareSessionPasswordResult> {
  return invokeCommand<ShareSessionPasswordResult>("share_session_password_reveal", {
    input: { sessionId },
  });
}

export function shareSessionStop(): Promise<Ack> {
  return invokeCommand<Ack>("share_session_stop");
}

export function channelsTelegramPoll(input: TelegramPollInput = {}): Promise<TelegramPollResult> {
  return invokeCommand<TelegramPollResult>("channels_telegram_poll", { input });
}

export function channelsTelegramSend(input: {
  chatId?: string;
  text: string;
  replyToMessageId?: number;
}): Promise<Ack> {
  return invokeCommand<Ack>("channels_telegram_send", { input });
}

export function channelsTelegramTest(input: TelegramTestInput): Promise<TelegramConnectionResult> {
  return invokeCommand<TelegramConnectionResult>("channels_telegram_test", { input });
}

export function channelsTelegramTokenSaveVerified(input: TelegramTokenSaveInput): Promise<Ack> {
  return invokeCommand<Ack>("channels_telegram_token_save_verified", { input });
}

export function channelsTelegramTokenClear(): Promise<Ack> {
  return invokeCommand<Ack>("channels_telegram_token_clear");
}

export function channelsDingTalkPoll(input: DingTalkPollInput = {}): Promise<DingTalkPollResult> {
  return invokeCommand<DingTalkPollResult>("channels_dingtalk_poll", { input });
}

export function channelsDingTalkSend(input: DingTalkSendInput): Promise<Ack> {
  return invokeCommand<Ack>("channels_dingtalk_send", { input });
}

export function channelsDingTalkTest(input: DingTalkTestInput): Promise<Ack> {
  return invokeCommand<Ack>("channels_dingtalk_test", { input });
}

export function channelsEmailPasswordSaveVerified(input: EmailPasswordSaveInput): Promise<Ack> {
  return invokeCommand<Ack>("channels_email_password_save_verified", { input });
}

export function channelsEmailTest(): Promise<Ack> {
  return invokeCommand<Ack>("channels_email_test");
}

export function channelsEmailFetchSubmission(
  input: EmailFetchSubmissionInput = {},
): Promise<EmailFetchSubmissionResult> {
  return invokeCommand<EmailFetchSubmissionResult>("channels_email_fetch_submission", { input });
}
