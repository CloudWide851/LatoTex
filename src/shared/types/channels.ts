import type { TelegramProxyMode } from "./app-extended";

export type ChannelPrefs = {
  telegramEnabled?: boolean;
  telegramChatId?: string;
  telegramApiBaseUrl?: string;
  telegramProxyMode?: TelegramProxyMode;
  telegramManualProxyUrl?: string;
  telegramTokenStored?: boolean;
  /** Legacy migration field; never populate from the WebView. */
  telegramProxyEnabled?: boolean;
  dingtalkEnabled?: boolean;
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  emailEnabled?: boolean;
  emailAddress?: string;
  emailImapHost?: string;
  emailImapPort?: number;
  emailSecurity?: "tls" | "starttls" | "plain" | string;
  emailUsername?: string;
  emailMailbox?: string;
  emailSearchKeywords?: string;
  emailMaxResults?: number;
};

export type EmailPasswordSaveInput = {
  password: string;
};

export type EmailFetchSubmissionInput = {
  limit?: number;
};

export type EmailSubmissionItem = {
  id: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
  matchReason: string;
  statusTag: string;
};

export type EmailFetchSubmissionResult = {
  items: EmailSubmissionItem[];
  status: string;
};

export type TelegramPollInput = {
  offset?: number;
  limit?: number;
  timeoutSecs?: number;
};

export type TelegramUpdateItem = {
  updateId: number;
  messageId: number;
  chatId: string;
  username: string;
  text: string;
};

export type TelegramPollResult = {
  nextOffset: number;
  updates: TelegramUpdateItem[];
};

export type DingTalkPollInput = {
  limit?: number;
};

export type DingTalkUpdateItem = {
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  replyToken?: string | null;
};

export type DingTalkPollResult = {
  updates: DingTalkUpdateItem[];
  status: string;
};

export type DingTalkSendInput = {
  replyToken?: string | null;
  webhook?: string | null;
  text: string;
};

export type DingTalkTestInput = {
  clientId: string;
  clientSecret: string;
};
