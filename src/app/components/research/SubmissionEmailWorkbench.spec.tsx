// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelsEmailFetchSubmission } from "../../../shared/api/share";
import {
  buildEmailRebuttalDraft,
  emailChannelErrorText,
  SubmissionEmailWorkbench,
} from "./SubmissionEmailWorkbench";

vi.mock("../../../shared/api/share", () => ({
  channelsEmailFetchSubmission: vi.fn(),
}));

const messages: Record<string, string> = {
  "research.email.queue": "投稿邮件",
  "research.email.sync": "同步投稿邮件",
  "research.email.syncing": "正在同步邮件",
  "research.email.empty": "暂无投稿邮件",
  "research.email.configureTitle": "连接投稿邮箱",
  "research.email.configureDescription": "请先配置投稿收件箱。",
  "research.email.configureAction": "打开通道设置",
  "research.email.readyDescription": "投稿邮箱已配置，请同步邮件。",
  "research.email.noMatchesDescription": "没有邮件匹配当前投稿关键词。",
  "research.email.synced": "{count} 封邮件",
  "research.email.use": "用于回复",
  "research.email.rebuttalSubject": "主题",
  "research.email.rebuttalFrom": "发件人",
  "research.email.rebuttalDate": "日期",
  "settings.channels.emailUntitled": "无标题邮件",
  "settings.channels.emailStatus.revision": "需修改",
  "settings.channels.errorEmailAuthFailed": "IMAP 登录失败。",
  "settings.channels.errorEmailGeneric": "邮箱获取失败。",
};

const t = (key: any) => messages[String(key)] ?? String(key);

describe("SubmissionEmailWorkbench", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(channelsEmailFetchSubmission).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("builds localized reviewer-response context from submission mail", () => {
    const draft = buildEmailRebuttalDraft({
      id: "mail-1",
      subject: "Revision decision",
      from: "editor@example.test",
      date: "2026-06-15",
      preview: "Reviewer 2 asks for a stronger baseline.",
      matchReason: "revision",
      statusTag: "revision",
    }, t);

    expect(draft).toContain("主题: Revision decision");
    expect(draft).toContain("发件人: editor@example.test");
    expect(draft).toContain("Reviewer 2 asks for a stronger baseline.");
  });

  it("maps email backend errors to localized safe text", () => {
    expect(emailChannelErrorText("channels.email.auth_failed: password=secret", t)).toBe("IMAP 登录失败。");
    expect(emailChannelErrorText("channels.email.worker: panic detail", t)).toBe("邮箱获取失败。");
  });

  it("syncs submission mail and sends the selected item to the rebuttal flow", async () => {
    vi.mocked(channelsEmailFetchSubmission).mockResolvedValue({
      status: "ok",
      items: [{
        id: "mail-1",
        subject: "Major revision",
        from: "editor@example.test",
        date: "2026-06-15",
        preview: "Please address the reviewer comments.",
        matchReason: "revision",
        statusTag: "revision",
      }],
    });
    const onUseEmail = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SubmissionEmailWorkbench
          busy={false}
          canUseRebuttal={true}
          emailConfigured={true}
          onOpenEmailSettings={vi.fn()}
          onUseEmail={onUseEmail}
          t={t}
        />,
      );
    });

    const syncButton = container.querySelector<HTMLButtonElement>('button[aria-label="同步投稿邮件"]');
    expect(syncButton).toBeTruthy();
    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(channelsEmailFetchSubmission).toHaveBeenCalledWith({ limit: 8 });
    expect(container.textContent).toContain("Major revision");

    const useButton = container.querySelector<HTMLButtonElement>('button[aria-label="用于回复: Major revision"]');
    expect(useButton).toBeTruthy();
    await act(async () => {
      useButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onUseEmail).toHaveBeenCalledWith(expect.stringContaining("Major revision"));

    await act(async () => {
      root.unmount();
    });
  });

  it("guides an unconfigured inbox to Channels settings", async () => {
    const onOpenEmailSettings = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SubmissionEmailWorkbench
          busy={false}
          canUseRebuttal={false}
          emailConfigured={false}
          onOpenEmailSettings={onOpenEmailSettings}
          onUseEmail={vi.fn()}
          t={t}
        />,
      );
    });

    expect(container.textContent).toContain("请先配置投稿收件箱。");
    const settingsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打开通道设置"),
    );
    expect(settingsButton).toBeTruthy();
    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenEmailSettings).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="同步投稿邮件"]')?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("distinguishes a completed sync with no keyword matches", async () => {
    vi.mocked(channelsEmailFetchSubmission).mockResolvedValue({ status: "channels.email.no_matches", items: [] });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SubmissionEmailWorkbench
          busy={false}
          canUseRebuttal={true}
          emailConfigured={true}
          onOpenEmailSettings={vi.fn()}
          onUseEmail={vi.fn()}
          t={t}
        />,
      );
    });
    expect(container.textContent).toContain("投稿邮箱已配置，请同步邮件。");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="同步投稿邮件"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("没有邮件匹配当前投稿关键词。");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("暂无投稿邮件");

    await act(async () => {
      root.unmount();
    });
  });
});
