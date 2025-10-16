const EDITABLE_SELECTOR = "input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input:not([type]), textarea";
const BUTTON_CONTAINER_CLASS = "gemini-voice-controls";
const BUTTON_CLASS = "gemini-voice-dictation";
const REMOVE_BUTTON_CLASS = "gemini-voice-remove";
const LISTENING_CLASS = "gemini-voice-dictation--listening";
const DEFAULT_TITLE = "Voice to Text";
const REMOVE_TITLE = "Remove microphone button";

const buttonMap = new Map();
let dictationSession = null;
let mutationObserver;
let dictationLanguagePreference = "fa-IR";
let showVoiceButtons = true;
let onlyTextarea = true;
let allowedSites = [];
let currentHostname = "";

const VOICE_COMMANDS = {
  "fa": {
    "نقطه": ".",
    "ویرگول": "،",
    "سوال": "؟",
    "علامت سوال": "؟",
    "تعجب": "!",
    "علامت تعجب": "!",
    "خط جدید": "\n",
    "اینتر": "\n",
    "دونقطه": ":",
    "نقطه ویرگول": ";",
    "خط تیره": "-",
    "کروشه باز": "[",
    "کروشه بسته": "]",
    "پرانتز باز": "(",
    "پرانتز بسته": ")",
    "گیومه باز": "«",
    "گیومه بسته": "»",
  },
  "en": {
    "period": ".",
    "dot": ".",
    "comma": ",",
    "question mark": "?",
    "exclamation": "!",
    "exclamation mark": "!",
    "new line": "\n",
    "enter": "\n",
    "colon": ":",
    "semicolon": ";",
    "dash": "-",
    "hyphen": "-",
    "open bracket": "[",
    "close bracket": "]",
    "open parenthesis": "(",
    "close parenthesis": ")",
    "quote": '"',
  }
};

try {
  currentHostname = window.location.hostname;
} catch (error) {
  console.error("Could not get hostname:", error);
}

chrome.storage?.local?.get([
  "dictationLanguage",
  "showVoiceButtons",
  "onlyTextarea",
  "allowedSites"
], ({ dictationLanguage, showVoiceButtons: showButtons, onlyTextarea: textareaOnly, allowedSites: sites }) => {
  console.log("🔧 Extension loaded on:", currentHostname);
  console.log("📋 Settings:", { 
    showButtons, 
    allowedSites: sites || "(empty - all sites allowed)",
    language: dictationLanguage 
  });
  
  updateDictationLanguage(dictationLanguage);
  if (typeof showButtons === "boolean") {
    showVoiceButtons = showButtons;
  }
  if (typeof textareaOnly === "boolean") {
    onlyTextarea = textareaOnly;
  }
  updateAllowedSites(sites);
  
  if (document.readyState !== "loading") {
    refreshVoiceButtons();
  } else {
    document.addEventListener("DOMContentLoaded", () => refreshVoiceButtons(), { once: true });
  }
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "dictationLanguage")) {
    updateDictationLanguage(changes.dictationLanguage.newValue);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "showVoiceButtons")) {
    showVoiceButtons = changes.showVoiceButtons.newValue;
    refreshVoiceButtons();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "allowedSites")) {
    updateAllowedSites(changes.allowedSites.newValue);
    refreshVoiceButtons();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeVoiceDictation);
} else {
  initializeVoiceDictation();
}

function initializeVoiceDictation() {
  addVoiceButtonStyles();
  scanForEditables(document.body || document);
  if (!mutationObserver) {
    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }
}

function scanForEditables(root) {
  if (!root) {
    return;
  }

  if (!showVoiceButtons || !isSiteAllowed()) {
    return;
  }

  if (root instanceof Element && isVoiceEligible(root)) {
    attachVoiceButton(root);
  }

  const nodes = root.querySelectorAll?.(EDITABLE_SELECTOR) || [];
  for (const node of nodes) {
    if (isVoiceEligible(node)) {
      attachVoiceButton(node);
    }
  }
}

function refreshVoiceButtons() {
  if (!showVoiceButtons || !isSiteAllowed()) {
    for (const [element] of [...buttonMap.entries()]) {
      teardownVoiceButton(element);
    }
    return;
  }

  for (const [element] of [...buttonMap.entries()]) {
    if (!isVoiceEligible(element)) {
      teardownVoiceButton(element);
    }
  }

  scanForEditables(document.body || document);
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        scanForEditables(node);
      }
    }

    for (const node of mutation.removedNodes) {
      if (node instanceof Element) {
        removeVoiceButtons(node);
      }
    }
  }
}

function attachVoiceButton(element) {
  if (buttonMap.has(element) || !showVoiceButtons || !isSiteAllowed()) {
    return;
  }

  const container = document.createElement("div");
  container.className = BUTTON_CONTAINER_CLASS;

  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.className = BUTTON_CLASS;
  micButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
  micButton.title = DEFAULT_TITLE;
  micButton.setAttribute("aria-label", DEFAULT_TITLE);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = REMOVE_BUTTON_CLASS;
  removeButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  removeButton.title = REMOVE_TITLE;
  removeButton.setAttribute("aria-label", REMOVE_TITLE);

  micButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleDictation(element, micButton);
  });

  removeButton.addEventListener("click", (event) => {
    console.log("Remove button event triggered");
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (dictationSession?.element === element) {
      stopDictation(true);
    }
    teardownVoiceButton(element);
  });

  container.appendChild(micButton);
  container.appendChild(removeButton);
  element.insertAdjacentElement("afterend", container);
  
  buttonMap.set(element, { container, micButton, removeButton });
  console.log("Voice buttons attached to element:", element.tagName, element.type || "textarea");
}

function removeVoiceButtons(root) {
  if (buttonMap.has(root)) {
    teardownVoiceButton(root);
  }

  const nodes = root.querySelectorAll?.(EDITABLE_SELECTOR) || [];
  for (const node of nodes) {
    if (buttonMap.has(node)) {
      teardownVoiceButton(node);
    }
  }
}

function teardownVoiceButton(element) {
  const buttons = buttonMap.get(element);
  if (!buttons) {
    return;
  }
  if (dictationSession?.element === element) {
    stopDictation(true);
  }
  buttons.container.remove();
  buttonMap.delete(element);
}



function toggleDictation(element, button) {
  if (dictationSession?.element === element) {
    stopDictation(true);
    return;
  }
  startDictation(element, button);
}

function startDictation(element, button) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    notifyButton(button, "Speech recognition unsupported.");
    return;
  }

  if (dictationSession) {
    stopDictation(true);
  }

  const recognition = new SpeechRecognition();
  recognition.lang = detectLanguage(element);
  recognition.interimResults = true;
  recognition.continuous = true;

  const onUserInput = (event) => {
    if (session.updatingText) {
      return;
    }
    
    if (event.type === "keydown" && event.key === "Enter") {
      console.log("⏹ User pressed Enter - stopping recording");
      stopDictation(false);
    } else if (event.type === "input") {
      console.log("⏹ User started typing - stopping recording");
      stopDictation(false);
    }
  };

  const onFocusLost = () => {
    console.log("⏹ Element lost focus - stopping recording");
    stopDictation(false);
  };

  const session = {
    element,
    button,
    recognition,
    baseText: getElementText(element),
    finalText: "",
    interimText: "",
    stoppedManually: false,
    updatingText: false,
    onUserInput,
    onFocusLost
  };

  dictationSession = session;

  element.addEventListener("keydown", onUserInput);
  element.addEventListener("input", onUserInput);
  element.addEventListener("blur", onFocusLost);

  recognition.onresult = (event) => handleDictationResult(session, event);
  recognition.onerror = (event) => {
    notifyButton(button, event.error || "Voice error");
    stopDictation(true);
  };
  recognition.onend = () => finalizeDictation(session);

  try {
    recognition.start();
    element.focus({ preventScroll: false });
    button.classList.add(LISTENING_CLASS);
    button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
    button.setAttribute("aria-label", "Stop recording");
    button.title = "Stop recording";
  } catch (error) {
    notifyButton(button, error.message || "Could not start recording.");
    dictationSession = null;
  }
}

function handleDictationResult(session, event) {
  if (dictationSession !== session) {
    return;
  }

  let interim = "";
  let finalAdded = session.finalText;

  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (result.isFinal) {
      finalAdded += result[0].transcript;
    } else {
      interim += result[0].transcript;
    }
  }

  session.finalText = applyVoiceCommands(finalAdded);
  session.interimText = applyVoiceCommands(interim);

  const combined = combineText(session.baseText, session.finalText, session.interimText);
  
  session.updatingText = true;
  setElementText(session.element, combined);
  setTimeout(() => {
    if (session.updatingText) {
      session.updatingText = false;
    }
  }, 100);
}

function stopDictation(cancelled = false) {
  if (!dictationSession) {
    return;
  }

  dictationSession.stoppedManually = cancelled;

  try {
    dictationSession.recognition.stop();
  } catch (error) {
    finalizeDictation(dictationSession);
  }
}

function finalizeDictation(session) {
  if (dictationSession !== session) {
    return;
  }

  const { element, button, baseText, finalText, stoppedManually, onUserInput, onFocusLost } = session;
  
  if (onUserInput) {
    element.removeEventListener("keydown", onUserInput);
    element.removeEventListener("input", onUserInput);
  }
  if (onFocusLost) {
    element.removeEventListener("blur", onFocusLost);
  }

  const completed = combineText(baseText, finalText, "");

  if (!finalText && stoppedManually) {
    setElementText(element, baseText);
  } else {
    setElementText(element, completed);
  }

  button.classList.remove(LISTENING_CLASS);
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
  button.setAttribute("aria-label", DEFAULT_TITLE);
  button.title = DEFAULT_TITLE;

  dictationSession = null;
}

function combineText(base, finalText, interimText) {
  const addition = `${finalText || ""}${interimText || ""}`;
  if (!addition) {
    return base;
  }

  const trimmedBase = base ?? "";
  const additionStartsWithNewline = addition.startsWith("\n");
  const needsSpace = trimmedBase && !/\s$/.test(trimmedBase) && !additionStartsWithNewline;
  return `${trimmedBase}${needsSpace ? " " : ""}${addition}`;
}

function detectLanguage(element) {
  if (dictationLanguagePreference) {
    return dictationLanguagePreference;
  }

  return (
    element?.lang ||
    element?.closest?.("[lang]")?.lang ||
    document.documentElement.lang ||
    navigator.language ||
    "en-US"
  );
}

function notifyButton(button, message) {
  button.title = message;
  button.setAttribute("aria-label", message);
  button.classList.remove(LISTENING_CLASS);
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
  setTimeout(() => {
    button.title = DEFAULT_TITLE;
    button.setAttribute("aria-label", DEFAULT_TITLE);
  }, 4000);
}

function getElementText(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (isContentEditable(element)) {
    return element.textContent || "";
  }
  return "";
}

function setElementText(element, text) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = text.length;
    try {
      element.setSelectionRange(caret, caret);
    } catch (error) {
      /* ignore unsupported types */
    }
    return;
  }

  if (isContentEditable(element)) {
    element.textContent = text;
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.addRange(range);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function addVoiceButtonStyles() {
  if (document.getElementById("gemini-voice-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "gemini-voice-style";
  style.textContent = `
    .${BUTTON_CONTAINER_CLASS} {
      display: inline-flex !important;
      gap: 4px !important;
      margin-left: 6px !important;
      vertical-align: middle !important;
      position: relative !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    .${BUTTON_CLASS},
    .${REMOVE_BUTTON_CLASS} {
      padding: 6px !important;
      border: none !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      line-height: 1 !important;
      vertical-align: middle !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08) !important;
      position: relative !important;
      overflow: hidden !important;
      pointer-events: auto !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    .${BUTTON_CLASS} {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      color: #ffffff !important;
      min-width: 32px !important;
      min-height: 32px !important;
    }
    
    .${BUTTON_CLASS}:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 6px rgba(102, 126, 234, 0.4), 0 2px 4px rgba(118, 75, 162, 0.3) !important;
    }
    
    .${BUTTON_CLASS}:active {
      transform: translateY(0) !important;
    }
    
    .${BUTTON_CLASS}.${LISTENING_CLASS} {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
      animation: pulse 1.5s ease-in-out infinite !important;
    }
    
    .${REMOVE_BUTTON_CLASS} {
      background: linear-gradient(135deg, #64748b 0%, #475569 100%) !important;
      color: #ffffff !important;
      min-width: 28px !important;
      min-height: 32px !important;
    }
    
    .${REMOVE_BUTTON_CLASS}:hover {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 6px rgba(239, 68, 68, 0.4) !important;
    }
    
    .${REMOVE_BUTTON_CLASS}:active {
      transform: translateY(0) !important;
    }
    
    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
      }
      50% {
        box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
      }
    }
    
    .${BUTTON_CLASS} svg,
    .${REMOVE_BUTTON_CLASS} svg {
      display: block !important;
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement || document.body || document).appendChild(style);
}

function isVoiceEligible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.dataset.geminiVoiceIgnore === "true") {
    return false;
  }
  
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  
  if (element instanceof HTMLInputElement) {
    if (onlyTextarea) {
      return false;
    }
    const allowedTypes = ["text", "search", "email", "url", "tel", ""];
    return allowedTypes.includes(element.type);
  }
  
  return false;
}

function updateDictationLanguage(value) {
  if (typeof value === "string" && value.trim()) {
    dictationLanguagePreference = value.trim();
  } else {
    dictationLanguagePreference = "fa-IR";
  }
}

function applyVoiceCommands(text) {
  if (!text) {
    return text;
  }

  const lang = dictationLanguagePreference.startsWith("fa") ? "fa" : "en";
  const commands = VOICE_COMMANDS[lang] || {};
  
  let result = text;
  
  for (const [command, replacement] of Object.entries(commands)) {
    const regex = new RegExp(`\\b${command}\\b`, "gi");
    result = result.replace(regex, replacement);
  }
  
  return result;
}

function updateAllowedSites(value) {
  if (typeof value !== "string" || !value.trim()) {
    allowedSites = [];
    return;
  }
  
  allowedSites = value
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
  
  console.log("Allowed sites updated:", allowedSites);
}

function isSiteAllowed() {
  if (allowedSites.length === 0) {
    console.log("✅ Whitelist empty - all sites allowed");
    return true;
  }
  
  if (!currentHostname) {
    console.log("❌ No hostname detected");
    return false;
  }
  
  const hostname = currentHostname.toLowerCase();
  console.log(`🔍 Checking site: ${hostname} against whitelist:`, allowedSites);
  
  for (const pattern of allowedSites) {
    if (matchDomain(hostname, pattern)) {
      console.log(`✅ Site allowed: ${hostname} matches ${pattern}`);
      return true;
    }
  }
  
  console.log(`❌ Site not allowed: ${hostname} (whitelist active with ${allowedSites.length} entries)`);
  return false;
}

function matchDomain(hostname, pattern) {
  if (pattern === hostname) {
    return true;
  }
  
  if (pattern.startsWith("*.")) {
    const domain = pattern.slice(2);
    if (hostname === domain) {
      return true;
    }
    if (hostname.endsWith("." + domain)) {
      return true;
    }
  }
  
  if (pattern.startsWith("*")) {
    const domain = pattern.slice(1);
    if (hostname.endsWith(domain)) {
      return true;
    }
  }
  
  return false;
}

function insertTextIntoActiveElement(text) {
  const active = document.activeElement;
  if (!active) {
    return { ok: false, error: "No active element." };
  }

  if (isStandardInput(active)) {
    insertIntoInput(active, text);
    return { ok: true };
  }

  if (isContentEditable(active)) {
    insertIntoContentEditable(active, text);
    return { ok: true };
  }

  const editable = findClosestEditable(active);
  if (editable) {
    if (isStandardInput(editable)) {
      insertIntoInput(editable, text);
    } else {
      insertIntoContentEditable(editable, text);
    }
    return { ok: true };
  }

  return { ok: false, error: "Active element is not editable." };
}

function isStandardInput(element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }

  if (element instanceof HTMLInputElement) {
    const allowedTypes = new Set([
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password"
    ]);
    return allowedTypes.has(element.type) || element.type === "";
  }

  return true;
}

function isContentEditable(element) {
  return element instanceof HTMLElement && element.isContentEditable;
}

function insertIntoInput(element, text) {
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  const value = element.value;
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
  element.value = nextValue;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  const position = start + text.length;
  element.setSelectionRange(position, position);
}

function insertIntoContentEditable(element, text) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  if (selection.rangeCount === 0) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.addRange(range);
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function findClosestEditable(element) {
  return element.closest?.("input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "insertText" && typeof message.text === "string") {
    const result = insertTextIntoActiveElement(message.text);
    sendResponse(result);
    return;
  }
  sendResponse({ ok: false, error: "Unsupported message." });
});
