import type {
  Ack,
  DingTalkPollInput,
  DingTalkPollResult,
  DingTalkSendInput,
  DingTalkTestInput,
  ShareSessionInfo,
  TelegramPollInput,
  TelegramPollResult,
  TelegramTestInput,
} from "../types/app";
import { invokeCommand } from "./core";

export function shareSessionCreate(
  projectId: string,
  targetPath: string,
  mode: "local" | "remote" = "remote",
  sessionName?: string,
): Promise<ShareSessionInfo> {
  return invokeCommand<ShareSessionInfo>("share_session_create", {
    input: { projectId, targetPath, mode, sessionName },
  });
}

export function shareSessionStatus(): Promise<ShareSessionInfo> {
  return invokeCommand<ShareSessionInfo>("share_session_status");
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

export function channelsTelegramTest(input: TelegramTestInput): Promise<Ack> {
  return invokeCommand<Ack>("channels_telegram_test", { input });
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
