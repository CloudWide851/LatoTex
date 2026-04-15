import { bootstrapSharePage } from "/assets/share_page_app.js";
import { mountDesktopSharePage } from "/assets/share_page_desktop.js";
import { createI18n, detectDevice, detectLocale } from "/assets/share_page_i18n.js";
import { mountMobileSharePage } from "/assets/share_page_mobile.js";

const params = new URLSearchParams(window.location.search);
const locale = detectLocale(params.get("lang") || params.get("locale"));
const i18n = createI18n(locale);
const device = detectDevice();
const root = document.getElementById("share-root");

if (root) {
  if (device === "mobile") {
    mountMobileSharePage(root);
  } else {
    mountDesktopSharePage(root);
  }
}

void bootstrapSharePage({ device, i18n, locale });
