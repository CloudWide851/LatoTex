import { describe, expect, it } from "vitest";
import { channelErrorText } from "./ChannelsSettingsSection";

const messages: Record<string, string> = {
  "settings.channels.errorTelegramTransport": "无法连接 Telegram Bot API。",
  "settings.channels.errorTelegramUnauthorized": "Telegram 拒绝了该 Bot Token。",
  "settings.channels.errorTelegramHttp": "Telegram Bot API 返回了 HTTP 错误。",
  "settings.channels.errorTelegramGeneric": "Telegram 通道测试失败。",
};

const t = (key: any) => messages[String(key)] ?? String(key);

describe("channelErrorText", () => {
  it("maps telegram transport errors without exposing raw backend details", () => {
    expect(channelErrorText("channels.telegram.transport: token=123:abc", t)).toBe(
      "无法连接 Telegram Bot API。",
    );
  });

  it("maps known and unknown telegram http errors", () => {
    expect(channelErrorText("channels.telegram.http_401", t)).toBe(
      "Telegram 拒绝了该 Bot Token。",
    );
    expect(channelErrorText("channels.telegram.http_502", t)).toBe(
      "Telegram Bot API 返回了 HTTP 错误。",
    );
  });
});
