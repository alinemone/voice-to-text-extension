chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([
    "dictationLanguage",
    "showVoiceButtons",
    "enableTextarea",
    "enabledInputTypes",
    "customSelectors",
    "allowedSites"
  ], (stored) => {
    const defaults = {};
    
    if (!stored.dictationLanguage) {
      defaults.dictationLanguage = "fa-IR";
    }
    if (typeof stored.showVoiceButtons !== "boolean") {
      defaults.showVoiceButtons = true;
    }
    if (typeof stored.enableTextarea !== "boolean") {
      defaults.enableTextarea = true;
    }
    if (!Array.isArray(stored.enabledInputTypes)) {
      defaults.enabledInputTypes = [];
    }
    if (typeof stored.customSelectors !== "string") {
      defaults.customSelectors = "";
    }
    if (typeof stored.allowedSites !== "string") {
      defaults.allowedSites = "";
    }
    
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });
});
