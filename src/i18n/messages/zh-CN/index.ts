import type { MessageKey } from "../en-US/index";
import { zhCN_app } from "./app";
import { zhCN_common } from "./common";
import { zhCN_topbar } from "./topbar";
import { zhCN_nav } from "./nav";
import { zhCN_window } from "./window";
import { zhCN_shortcut } from "./shortcut";
import { zhCN_tray } from "./tray";
import { zhCN_workspace } from "./workspace";
import { zhCN_preview } from "./preview";
import { zhCN_explorer } from "./explorer";
import { zhCN_editor } from "./editor";
import { zhCN_table } from "./table";
import { zhCN_chat } from "./chat";
import { zhCN_draw } from "./draw";
import { zhCN_agent } from "./agent";
import { zhCN_analysis } from "./analysis";
import { zhCN_library } from "./library";
import { zhCN_git } from "./git";
import { zhCN_settings } from "./settings";
import { zhCN_share } from "./share";
import { zhCN_toast } from "./toast";
import { zhCN_log } from "./log";
import { zhCN_misc } from "./misc";

const zhCNRaw = {
  ...zhCN_app,
  ...zhCN_common,
  ...zhCN_topbar,
  ...zhCN_nav,
  ...zhCN_window,
  ...zhCN_shortcut,
  ...zhCN_tray,
  ...zhCN_workspace,
  ...zhCN_preview,
  ...zhCN_explorer,
  ...zhCN_editor,
  ...zhCN_table,
  ...zhCN_chat,
  ...zhCN_draw,
  ...zhCN_agent,
  ...zhCN_analysis,
  ...zhCN_library,
  ...zhCN_git,
  ...zhCN_settings,
  ...zhCN_share,
  ...zhCN_toast,
  ...zhCN_log,
  ...zhCN_misc,
} as const;

export const zhCN: Record<MessageKey, string> = zhCNRaw as Record<MessageKey, string>;
