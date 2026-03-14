import { enUS_app } from "./app";
import { enUS_common } from "./common";
import { enUS_topbar } from "./topbar";
import { enUS_nav } from "./nav";
import { enUS_window } from "./window";
import { enUS_shortcut } from "./shortcut";
import { enUS_tray } from "./tray";
import { enUS_workspace } from "./workspace";
import { enUS_preview } from "./preview";
import { enUS_explorer } from "./explorer";
import { enUS_editor } from "./editor";
import { enUS_table } from "./table";
import { enUS_chat } from "./chat";
import { enUS_draw } from "./draw";
import { enUS_agent } from "./agent";
import { enUS_analysis } from "./analysis";
import { enUS_library } from "./library";
import { enUS_git } from "./git";
import { enUS_settings } from "./settings";
import { enUS_share } from "./share";
import { enUS_toast } from "./toast";
import { enUS_log } from "./log";
import { enUS_misc } from "./misc";

export const enUS = {
  ...enUS_app,
  ...enUS_common,
  ...enUS_topbar,
  ...enUS_nav,
  ...enUS_window,
  ...enUS_shortcut,
  ...enUS_tray,
  ...enUS_workspace,
  ...enUS_preview,
  ...enUS_explorer,
  ...enUS_editor,
  ...enUS_table,
  ...enUS_chat,
  ...enUS_draw,
  ...enUS_agent,
  ...enUS_analysis,
  ...enUS_library,
  ...enUS_git,
  ...enUS_settings,
  ...enUS_share,
  ...enUS_toast,
  ...enUS_log,
  ...enUS_misc,
} as const;

export type MessageKey = keyof typeof enUS;
