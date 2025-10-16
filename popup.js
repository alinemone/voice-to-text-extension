const DEFAULT_MODELS = [
  "models/gemini-1.5-flash-latest",
  "models/gemini-1.5-pro-latest",
  "models/gemini-1.0-pro",
  "models/gemini-1.0-pro-vision"
];

const apiKeyInput = document.getElementById("apiKey");
const saveTokenButton = document.getElementById("saveToken");
const modelSelect = document.getElementById("model");
const saveModelButton = document.getElementById("saveModel");
const dictationLanguageSelect = document.getElementById("dictationLanguage");
const saveDictationLanguageButton = document.getElementById("saveDictationLanguage");
const showVoiceButtonsCheckbox = document.getElementById("showVoiceButtons");
const onlyTextareaCheckbox = document.getElementById("onlyTextarea");
const allowedSitesInput = document.getElementById("allowedSites");
const saveAllowedSitesButton = document.getElementById("saveAllowedSites");
const clearAllowedSitesButton = document.getElementById("clearAllowedSites");
const statusElement = document.getElementById("status");

let availableModels = [...DEFAULT_MODELS];

initialize();

async function initialize() {
  populateModels();

  const stored = await chrome.storage.local.get([
    "geminiApiKey",
    "geminiModel",
    "dictationLanguage",
    "showVoiceButtons",
    "onlyTextarea",
    "allowedSites"
  ]);

  if (stored.geminiApiKey) {
    apiKeyInput.value = stored.geminiApiKey;
    await loadModels(stored.geminiModel);
  } else if (stored.geminiModel) {
    selectModel(stored.geminiModel);
  }

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

  if (typeof stored.onlyTextarea === "boolean") {
    onlyTextareaCheckbox.checked = stored.onlyTextarea;
  } else {
    onlyTextareaCheckbox.checked = true;
  }

  if (typeof stored.allowedSites === "string") {
    allowedSitesInput.value = stored.allowedSites;
  }

  saveTokenButton.addEventListener("click", handleSaveToken);
  saveModelButton.addEventListener("click", handleSaveModel);
  saveDictationLanguageButton.addEventListener("click", handleSaveDictationLanguage);
  saveAllowedSitesButton.addEventListener("click", handleSaveAllowedSites);
  clearAllowedSitesButton.addEventListener("click", handleClearAllowedSites);
  
  showVoiceButtonsCheckbox.addEventListener("change", handleToggleVoiceButtons);
  onlyTextareaCheckbox.addEventListener("change", handleToggleOnlyTextarea);

  apiKeyInput.addEventListener("change", () => {
    setStatus("توکن تغییر کرد. برای ذخیره دکمه ذخیره را بزنید.");
  });

  modelSelect.addEventListener("change", () => {
    setStatus("مدل تغییر کرد. برای ذخیره دکمه ذخیره را بزنید.");
  });

  dictationLanguageSelect.addEventListener("change", () => {
    setStatus("زبان تغییر کرد. برای ذخیره دکمه ذخیره را بزنید.");
  });

  systemRoleInput.addEventListener("input", () => {
    const length = systemRoleInput.value.trim().length;
    if (length > 0) {
      setStatus(`${length} کاراکتر در نقش سیستم.`);
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

function populateModels() {
  modelSelect.innerHTML = "";
  for (const model of availableModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model.replace("models/", "");
    modelSelect.append(option);
  }
}

function selectModel(value) {
  if (!value) {
    return;
  }
  if ([...modelSelect.options].some((option) => option.value === value)) {
    modelSelect.value = value;
  }
}

async function handleSaveToken() {
  const token = apiKeyInput.value.trim();
  if (!token) {
    setStatus("لطفا یک توکن معتبر وارد کنید.");
    return;
  }

  await chrome.storage.local.set({ geminiApiKey: token });
  setStatus("✅ توکن ذخیره شد.");
  await loadModels(await getStoredModel());
}

async function handleSaveModel() {
  const chosen = modelSelect.value;
  if (!chosen) {
    setStatus("لطفا ابتدا یک مدل انتخاب کنید.");
    return;
  }
  await chrome.storage.local.set({ geminiModel: chosen });
  setStatus(`✅ مدل ذخیره شد: ${chosen.replace("models/", "")}`);
}

async function handleSaveDictationLanguage() {
  const language = dictationLanguageSelect.value;
  await chrome.storage.local.set({ dictationLanguage: language });
  const languageName = language === "fa-IR" ? "فارسی" : "انگلیسی";
  setStatus(`✅ زبان ذخیره شد: ${languageName}`);
}

async function handleToggleVoiceButtons() {
  const isEnabled = showVoiceButtonsCheckbox.checked;
  await chrome.storage.local.set({ showVoiceButtons: isEnabled });
  setStatus(isEnabled ? "✅ دکمه‌های میکروفن فعال شدند." : "✅ دکمه‌های میکروفن غیرفعال شدند.");
  
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    chrome.tabs.reload(tabs[0].id);
  }
}

async function handleToggleOnlyTextarea() {
  const isEnabled = onlyTextareaCheckbox.checked;
  await chrome.storage.local.set({ onlyTextarea: isEnabled });
  setStatus(isEnabled ? "✅ فقط textarea فعال شد." : "✅ هم input و هم textarea فعال شد.");
  
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    chrome.tabs.reload(tabs[0].id);
  }
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
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  }
}

async function handleClearAllowedSites() {
  allowedSitesInput.value = "";
  await chrome.storage.local.set({ allowedSites: "" });
  setStatus("✅ لیست پاک شد. همه سایت‌ها فعال شدند.");
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  }
}

async function loadModels(preferredModel) {
  const tokenPresent = apiKeyInput.value.trim();
  if (!tokenPresent) {
    availableModels = [...DEFAULT_MODELS];
    populateModels();
    selectModel(preferredModel || DEFAULT_MODELS[0]);
    return;
  }

  setStatus("⏳ در حال بارگذاری مدل‌ها...");
  modelSelect.disabled = true;

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "listModels" }, (result) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(result);
    });
  });

  if (response?.ok && Array.isArray(response.models) && response.models.length > 0) {
    availableModels = [...new Set(response.models)].sort();
    populateModels();
    const desired = preferredModel && availableModels.includes(preferredModel)
      ? preferredModel
      : availableModels[0];
    modelSelect.value = desired;
    setStatus("✅ مدل‌ها بارگذاری شدند. مدل خود را انتخاب و ذخیره کنید.");
  } else {
    availableModels = [...new Set([...availableModels])];
    populateModels();
    const desired = preferredModel && availableModels.includes(preferredModel)
      ? preferredModel
      : availableModels[0];
    modelSelect.value = desired;
    setStatus(response?.error || "❌ خطا در بارگذاری مدل‌ها، از مدل‌های پیش‌فرض استفاده می‌شود.");
  }

  modelSelect.disabled = false;
}

function setStatus(message) {
  statusElement.textContent = message;
}

async function getStoredModel() {
  const { geminiModel } = await chrome.storage.local.get("geminiModel");
  return geminiModel;
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
