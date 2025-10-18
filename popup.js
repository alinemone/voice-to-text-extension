const dictationLanguageSelect = document.getElementById("dictationLanguage");
const saveDictationLanguageButton = document.getElementById("saveDictationLanguage");
const showVoiceButtonsCheckbox = document.getElementById("showVoiceButtons");
const enableTextareaCheckbox = document.getElementById("enableTextarea");
const enableInputTextCheckbox = document.getElementById("enableInputText");
const enableInputSearchCheckbox = document.getElementById("enableInputSearch");
const enableInputEmailCheckbox = document.getElementById("enableInputEmail");
const enableInputUrlCheckbox = document.getElementById("enableInputUrl");
const enableInputTelCheckbox = document.getElementById("enableInputTel");
const customSelectorsInput = document.getElementById("customSelectors");
const saveCustomSelectorsButton = document.getElementById("saveCustomSelectors");
const clearCustomSelectorsButton = document.getElementById("clearCustomSelectors");
const allowedSitesInput = document.getElementById("allowedSites");
const saveAllowedSitesButton = document.getElementById("saveAllowedSites");
const clearAllowedSitesButton = document.getElementById("clearAllowedSites");
const statusElement = document.getElementById("status");

const inputTypeCheckboxes = [
  enableInputTextCheckbox,
  enableInputSearchCheckbox,
  enableInputEmailCheckbox,
  enableInputUrlCheckbox,
  enableInputTelCheckbox
];

initialize();

async function initialize() {
  const stored = await chrome.storage.local.get([
    "dictationLanguage",
    "showVoiceButtons",
    "enableTextarea",
    "enabledInputTypes",
    "customSelectors",
    "allowedSites"
  ]);

  if (typeof stored.dictationLanguage === "string" && stored.dictationLanguage) {
    dictationLanguageSelect.value = stored.dictationLanguage;
  } else {
    dictationLanguageSelect.value = "fa-IR";
  }

  if (typeof stored.showVoiceButtons === "boolean") {
    showVoiceButtonsCheckbox.checked = stored.showVoiceButtons;
  } else {
    showVoiceButtonsCheckbox.checked = true;
  }

  if (typeof stored.enableTextarea === "boolean") {
    enableTextareaCheckbox.checked = stored.enableTextarea;
  } else {
    enableTextareaCheckbox.checked = true;
  }

  const enabledTypes = Array.isArray(stored.enabledInputTypes) ? stored.enabledInputTypes : [];
  for (const checkbox of inputTypeCheckboxes) {
    if (checkbox && checkbox.value) {
      checkbox.checked = enabledTypes.includes(checkbox.value);
    }
  }

  if (typeof stored.customSelectors === "string") {
    customSelectorsInput.value = stored.customSelectors;
  }

  if (typeof stored.allowedSites === "string") {
    allowedSitesInput.value = stored.allowedSites;
  }

  saveDictationLanguageButton.addEventListener("click", handleSaveDictationLanguage);
  saveCustomSelectorsButton.addEventListener("click", handleSaveCustomSelectors);
  clearCustomSelectorsButton.addEventListener("click", handleClearCustomSelectors);
  saveAllowedSitesButton.addEventListener("click", handleSaveAllowedSites);
  clearAllowedSitesButton.addEventListener("click", handleClearAllowedSites);
  
  showVoiceButtonsCheckbox.addEventListener("change", handleToggleVoiceButtons);
  enableTextareaCheckbox.addEventListener("change", handleToggleTextarea);
  
  for (const checkbox of inputTypeCheckboxes) {
    checkbox.addEventListener("change", handleInputTypeChange);
  }

  dictationLanguageSelect.addEventListener("change", () => {
    setStatus("زبان تغییر کرد. برای ذخیره دکمه ذخیره را بزنید.");
  });

  customSelectorsInput.addEventListener("input", () => {
    const lines = countNonEmptyLines(customSelectorsInput.value);
    if (lines > 0) {
      setStatus(`${lines} سلکتور سفارشی.`);
    } else {
      setStatus("");
    }
  });

  allowedSitesInput.addEventListener("input", () => {
    const lines = countNonEmptyLines(allowedSitesInput.value);
    if (lines > 0) {
      setStatus(`${lines} سایت در لیست مجاز.`);
    } else {
      setStatus("لیست خالی: همه سایت‌ها فعال");
    }
  });
}

async function handleSaveDictationLanguage() {
  const language = dictationLanguageSelect.value;
  await chrome.storage.local.set({ dictationLanguage: language });
  const languageNames = {
    "fa-IR": "فارسی",
    "en-US": "انگلیسی",
    "ar-SA": "عربی",
    "es-ES": "اسپانیایی",
    "fr-FR": "فرانسوی",
    "de-DE": "آلمانی",
    "tr-TR": "ترکی",
    "ru-RU": "روسی",
    "zh-CN": "چینی",
    "ja-JP": "ژاپنی"
  };
  const languageName = languageNames[language] || language;
  setStatus(`✅ زبان ذخیره شد: ${languageName}`);
  reloadAllTabs();
}

async function handleToggleVoiceButtons() {
  const isEnabled = showVoiceButtonsCheckbox.checked;
  await chrome.storage.local.set({ showVoiceButtons: isEnabled });
  setStatus(isEnabled ? "✅ دکمه‌های میکروفن فعال شدند." : "✅ دکمه‌های میکروفن غیرفعال شدند.");
  reloadAllTabs();
}

async function handleToggleTextarea() {
  const isEnabled = enableTextareaCheckbox.checked;
  await chrome.storage.local.set({ enableTextarea: isEnabled });
  setStatus(isEnabled ? "✅ Textarea فعال شد." : "✅ Textarea غیرفعال شد.");
  reloadAllTabs();
}

async function handleInputTypeChange() {
  const enabledTypes = [];
  for (const checkbox of inputTypeCheckboxes) {
    if (checkbox && checkbox.checked && checkbox.value) {
      enabledTypes.push(checkbox.value);
    }
  }
  
  await chrome.storage.local.set({ enabledInputTypes: enabledTypes });
  
  if (enabledTypes.length > 0) {
    setStatus(`✅ ${enabledTypes.length} نوع input فعال شد: ${enabledTypes.join(", ")}`);
  } else {
    setStatus("✅ هیچ input فعال نیست.");
  }
  
  reloadAllTabs();
}

async function handleSaveCustomSelectors() {
  const value = normalizeMultilineInput(customSelectorsInput.value);
  await chrome.storage.local.set({ customSelectors: value });
  const lines = countNonEmptyLines(value);
  if (lines > 0) {
    setStatus(`✅ ${lines} سلکتور سفارشی ذخیره شد.`);
  } else {
    setStatus("✅ لیست سلکتورها خالی شد.");
  }
  reloadAllTabs();
}

async function handleClearCustomSelectors() {
  customSelectorsInput.value = "";
  await chrome.storage.local.set({ customSelectors: "" });
  setStatus("✅ سلکتورهای سفارشی پاک شدند.");
  reloadAllTabs();
}

async function handleSaveAllowedSites() {
  const value = normalizeMultilineInput(allowedSitesInput.value);
  await chrome.storage.local.set({ allowedSites: value });
  const lines = countNonEmptyLines(value);
  if (lines > 0) {
    setStatus(`✅ ${lines} سایت ذخیره شد. (فقط این سایت‌ها فعال)`);
  } else {
    setStatus("✅ لیست خالی شد. (همه سایت‌ها فعال)");
  }
  reloadAllTabs();
}

async function handleClearAllowedSites() {
  allowedSitesInput.value = "";
  await chrome.storage.local.set({ allowedSites: "" });
  setStatus("✅ لیست پاک شد. همه سایت‌ها فعال شدند.");
  reloadAllTabs();
}

async function reloadAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
      chrome.tabs.reload(tab.id).catch(() => {});
    }
  }
}

function setStatus(message) {
  statusElement.textContent = message;
}

function normalizeMultilineInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function countNonEmptyLines(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return 0;
  }
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .length;
}
