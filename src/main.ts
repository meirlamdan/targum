import { createApp } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { i18n } from "./i18n";
import App from "./App.vue";
import RegionSelector from "./components/RegionSelector.vue";

if (getCurrentWindow().label === "ocr-overlay") {
  document.documentElement.dataset.window = "ocr-overlay";
  createApp(RegionSelector).mount("#app");
} else {
  createApp(App).use(i18n).mount("#app");
}
