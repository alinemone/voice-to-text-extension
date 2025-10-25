// ==================== CONSTANTS ====================
const BUTTON_CONTAINER_CLASS = "vtt-controls";
const BUTTON_CLASS = "vtt-mic-button";
const REMOVE_BUTTON_CLASS = "vtt-remove-button";
const LISTENING_CLASS = "vtt-listening";
const PROCESSING_CLASS = "vtt-processing";
const ERROR_CLASS = "vtt-error";

const DEFAULT_TITLE = "شروع ضبط صدا (کلیک کنید)";
const RECORDING_TITLE = "در حال ضبط... (کلیک برای توقف)";
const PROCESSING_TITLE = "در حال پردازش...";
const REMOVE_TITLE = "حذف دکمه میکروفون";

const VOICE_COMMANDS = {
  "fa": {
    "علامت سوال": "؟",
    "علامت تعجب": "!",
    "نقطه ویرگول": "؛",
    "نقطه": ".",
    "ویرگول": "،",
    "سوال": "؟",
    "تعجب": "!",
    "خط جدید": "\n",
    "اینتر": "\n",
    "دونقطه": ":",
    "خط تیره": "-",
    "کروشه باز": "[",
    "کروشه بسته": "]",
    "پرانتز باز": "(",
    "پرانتز بسته": ")",
    "گیومه باز": "«",
    "گیومه بسته": "»",
  },
  "en": {
    "question mark": "?",
    "exclamation mark": "!",
    "exclamation point": "!",
    "period": ".",
    "dot": ".",
    "comma": ",",
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

// ==================== STATE MANAGEMENT ====================
const state = {
  buttonMap: new Map(),
  activeSession: null,
  mutationObserver: null,
  config: {
    language: "fa-IR",
    showButtons: true,
    enableTextarea: true,
    enabledInputTypes: [],
    customSelectors: [],
    allowedSites: [],
  },
  currentHostname: "",
  cachedEditableSelector: "",
};

try {
  state.currentHostname = window.location.hostname;
} catch (error) {
  console.error("[VTT] Could not get hostname:", error);
}

// ==================== CONFIG MANAGER ====================
class ConfigManager {
  static async load() {
    return new Promise((resolve) => {
      chrome.storage?.local?.get([
        "dictationLanguage",
        "showVoiceButtons",
        "enableTextarea",
        "enabledInputTypes",
        "customSelectors",
        "allowedSites"
      ], (stored) => {
        state.config.language = stored.dictationLanguage || "fa-IR";
        state.config.showButtons = stored.showVoiceButtons !== false;
        state.config.enableTextarea = stored.enableTextarea !== false;
        state.config.enabledInputTypes = Array.isArray(stored.enabledInputTypes) ? stored.enabledInputTypes : [];
        state.config.customSelectors = this.parseMultiline(stored.customSelectors);
        state.config.allowedSites = this.parseMultiline(stored.allowedSites);

        this.buildEditableSelector();

        console.log("[VTT] Config loaded:", state.config);
        resolve();
      });
    });
  }

  static parseMultiline(value) {
    if (typeof value !== "string" || !value.trim()) return [];
    return value.split("\n").map(line => line.trim()).filter(line => line.length > 0);
  }

  static buildEditableSelector() {
    const selectors = [];

    if (state.config.enableTextarea) {
      selectors.push("textarea");
    }

    for (const type of state.config.enabledInputTypes) {
      selectors.push(`input[type='${type}']`);
    }

    selectors.push(...state.config.customSelectors);

    state.cachedEditableSelector = selectors.join(", ");
    console.log("[VTT] Editable selector:", state.cachedEditableSelector);
  }

  static isSiteAllowed() {
    if (state.config.allowedSites.length === 0) return true;
    if (!state.currentHostname) return false;

    const hostname = state.currentHostname.toLowerCase();
    return state.config.allowedSites.some(pattern => this.matchDomain(hostname, pattern));
  }

  static matchDomain(hostname, pattern) {
    pattern = pattern.toLowerCase();
    if (pattern === hostname) return true;
    if (pattern.startsWith("*.")) {
      const domain = pattern.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    if (pattern.startsWith("*")) {
      return hostname.endsWith(pattern.slice(1));
    }
    return false;
  }
}

// ==================== TEXT MANAGER ====================
class TextManager {
  static combineText(base, finalText, interimText) {
    const addition = `${finalText || ""}${interimText || ""}`;
    if (!addition) return base;

    const trimmedBase = base ?? "";
    if (!trimmedBase) return addition;

    // Check if addition starts with newline
    if (addition.startsWith("\n")) {
      return trimmedBase + addition;
    }

    // Check if addition starts with punctuation (no space needed)
    if (/^[.،؛:!؟?\-\]\)»"']/.test(addition)) {
      return trimmedBase + addition;
    }

    // Check if base ends with space or newline
    if (/[\s\n]$/.test(trimmedBase)) {
      return trimmedBase + addition;
    }

    // Otherwise add space
    return trimmedBase + " " + addition;
  }

  static getElementText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (this.isContentEditable(element)) {
      return element.textContent || "";
    }
    return "";
  }

  static setElementText(element, text) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.value !== text) {
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }

      const caret = text.length;
      try {
        if (element.selectionStart !== caret || element.selectionEnd !== caret) {
          element.setSelectionRange(caret, caret);
        }
      } catch (error) {
        // Ignore unsupported input types
      }
      return;
    }

    if (this.isContentEditable(element)) {
      if (element.textContent !== text) {
        element.textContent = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.addRange(range);
      }
    }
  }

  static isContentEditable(element) {
    return element instanceof HTMLElement && element.isContentEditable;
  }
}

// ==================== VOICE COMMAND PROCESSOR ====================
class VoiceCommandProcessor {
  static process(text) {
    if (!text) return text;

    const lang = state.config.language.startsWith("fa") ? "fa" : "en";
    const commands = VOICE_COMMANDS[lang] || {};

    let result = text;
    const sortedCommands = Object.entries(commands).sort((a, b) => b[0].length - a[0].length);

    for (const [command, replacement] of sortedCommands) {
      if (lang === "fa") {
        const regex = new RegExp(`(^|\\s)(${this.escapeRegex(command)})(\\s|$)`, "gi");
        result = result.replace(regex, (match, before, cmd, after) => {
          return before + replacement + after;
        });
      } else {
        const regex = new RegExp(`\\b${this.escapeRegex(command)}\\b`, "gi");
        result = result.replace(regex, replacement);
      }
    }

    return result;
  }

  static escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ==================== VOICE RECOGNITION MANAGER ====================
class VoiceRecognitionManager {
  constructor(element, button) {
    this.element = element;
    this.button = button;
    this.recognition = null;
    this.isActive = false;
    this.isPaused = false;

    // Text state - simplified approach
    this.accumulatedText = TextManager.getElementText(element); // All finalized text
    this.currentInterim = ""; // Current interim result

    this.restartAttempts = 0;
    this.maxRestarts = 50;

    this.updateTimer = null;
    this.restartTimer = null;

    this.setupRecognition();
    this.setupEventListeners();
  }

  setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error("Speech recognition not supported");
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = state.config.language;
    this.recognition.interimResults = true;
    this.recognition.continuous = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => this.handleStart();
    this.recognition.onresult = (event) => this.handleResult(event);
    this.recognition.onerror = (event) => this.handleError(event);
    this.recognition.onend = () => this.handleEnd();
  }

  setupEventListeners() {
    // Track last programmatic update to avoid false positives
    this.lastProgrammaticUpdate = 0;

    this.onUserInput = (event) => {
      if (this.isPaused) return;

      // Ignore all non-trusted events (programmatic)
      if (!event.isTrusted) return;

      const now = Date.now();

      // If we just updated programmatically (within 500ms), ignore input events
      // This prevents false detection when voice commands add newlines
      if (event.type === "input" && (now - this.lastProgrammaticUpdate) < 500) {
        console.log("[VTT] Ignoring input event - recent programmatic update");
        return;
      }

      if (event.type === "keydown" && event.key === "Enter" && !event.shiftKey) {
        console.log("[VTT] User pressed Enter - stopping recording");
        this.stop();
      } else if (event.type === "input") {
        // Get current text to compare
        const currentText = TextManager.getElementText(this.element);
        const expectedText = TextManager.combineText(this.accumulatedText, "", this.currentInterim);

        // Only stop if user actually typed something different
        if (currentText !== expectedText) {
          console.log("[VTT] User typed - stopping recording");
          this.stop();
        }
      }
    };

    this.onFocusLost = () => {
      if (!this.isPaused) {
        console.log("[VTT] Element lost focus - stopping recording");
        this.stop();
      }
    };
  }

  start() {
    if (this.isActive) return;

    try {
      this.isActive = true;
      this.restartAttempts = 0;

      // Get current text as base
      this.accumulatedText = TextManager.getElementText(this.element);
      this.currentInterim = "";

      this.recognition.start();
      this.element.focus({ preventScroll: true });

      // Attach event listeners
      this.element.addEventListener("keydown", this.onUserInput);
      this.element.addEventListener("input", this.onUserInput);
      this.element.addEventListener("blur", this.onFocusLost);

      UIManager.setButtonState(this.button, "recording");

      console.log("[VTT] Recording started. Base text length:", this.accumulatedText.length);
    } catch (error) {
      console.error("[VTT] Failed to start recording:", error);
      UIManager.showError(this.button, "خطا در شروع ضبط");
      this.cleanup();
    }
  }

  stop() {
    if (!this.isActive) return;

    console.log("[VTT] Stopping recording...");
    this.isActive = false;

    try {
      this.recognition.stop();
    } catch (error) {
      console.error("[VTT] Error stopping recognition:", error);
    }

    // Don't call cleanup here - let onend handle it
  }

  handleStart() {
    console.log("[VTT] Recognition started");
    UIManager.setButtonState(this.button, "recording");
  }

  handleResult(event) {
    if (!this.isActive) return;

    let finalText = "";
    let interimText = "";
    let hasFinal = false;

    // Process all results
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        finalText += transcript;
        hasFinal = true;
      } else {
        interimText += transcript;
      }
    }

    // Apply voice commands
    if (finalText) {
      finalText = VoiceCommandProcessor.process(finalText);
    }
    if (interimText) {
      interimText = VoiceCommandProcessor.process(interimText);
    }

    // Update accumulated text with finalized results
    if (hasFinal && finalText) {
      this.accumulatedText = TextManager.combineText(this.accumulatedText, finalText, "");
      console.log("[VTT] Final text added. Total length:", this.accumulatedText.length);
    }

    // Update current interim
    this.currentInterim = interimText;

    // Update UI
    this.updateElementText(hasFinal);
  }

  updateElementText(isImmediate = false) {
    // Clear any pending timer
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    const updateFn = () => {
      this.isPaused = true;

      const fullText = TextManager.combineText(this.accumulatedText, "", this.currentInterim);

      // Mark the timestamp before updating
      this.lastProgrammaticUpdate = Date.now();
      TextManager.setElementText(this.element, fullText);

      // Resume after a short delay
      setTimeout(() => {
        this.isPaused = false;
      }, 150);
    };

    if (isImmediate) {
      // Immediate update for final results
      updateFn();
    } else {
      // Debounced update for interim results
      this.updateTimer = setTimeout(updateFn, 100);
    }
  }

  handleError(event) {
    console.error("[VTT] Recognition error:", event.error);

    // Don't stop on recoverable errors
    if (event.error === "no-speech" || event.error === "audio-capture") {
      return;
    }

    if (event.error === "aborted") {
      // Normal abort, just cleanup
      this.cleanup();
      return;
    }

    UIManager.showError(this.button, `خطا: ${event.error}`);
    this.cleanup();
  }

  handleEnd() {
    console.log("[VTT] Recognition ended. Active:", this.isActive, "Restart attempts:", this.restartAttempts);

    if (!this.isActive) {
      // User stopped it manually
      this.cleanup();
      return;
    }

    // Auto restart for continuous recording
    if (this.restartAttempts >= this.maxRestarts) {
      console.log("[VTT] Max restart attempts reached");
      this.cleanup();
      return;
    }

    this.restartAttempts++;

    // Reset interim text before restart
    this.currentInterim = "";

    // Restart with a small delay
    this.restartTimer = setTimeout(() => {
      if (this.isActive) {
        try {
          this.recognition.start();
          console.log("[VTT] Recognition restarted. Attempt:", this.restartAttempts);
        } catch (error) {
          console.error("[VTT] Failed to restart:", error);
          this.cleanup();
        }
      }
    }, 100);
  }

  cleanup() {
    console.log("[VTT] Cleaning up session");

    this.isActive = false;
    this.isPaused = false;

    // Clear timers
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Remove event listeners
    this.element.removeEventListener("keydown", this.onUserInput);
    this.element.removeEventListener("input", this.onUserInput);
    this.element.removeEventListener("blur", this.onFocusLost);

    // Set final text - include any remaining interim text
    // This ensures we don't lose text that hasn't been finalized yet
    let finalText = this.accumulatedText;
    if (this.currentInterim) {
      finalText = TextManager.combineText(finalText, this.currentInterim, "");
      console.log("[VTT] Including interim text in final output:", this.currentInterim);
    }

    // Mark timestamp before final update
    this.lastProgrammaticUpdate = Date.now();
    TextManager.setElementText(this.element, finalText);

    // Reset UI
    UIManager.setButtonState(this.button, "idle");

    // Clear from state
    if (state.activeSession === this) {
      state.activeSession = null;
    }

    console.log("[VTT] Session cleaned up. Final text length:", finalText.length);
  }
}

// ==================== UI MANAGER ====================
class UIManager {
  static initialize() {
    this.addStyles();
  }

  static addStyles() {
    if (document.getElementById("vtt-styles")) return;

    const style = document.createElement("style");
    style.id = "vtt-styles";
    style.textContent = `
      .${BUTTON_CONTAINER_CLASS} {
        display: inline-flex !important;
        gap: 6px !important;
        margin-left: 8px !important;
        vertical-align: middle !important;
        position: relative !important;
        z-index: 2147483647 !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
        flex-shrink: 0 !important;
        align-items: center !important;
      }

      .${BUTTON_CLASS},
      .${REMOVE_BUTTON_CLASS} {
        padding: 8px !important;
        border: 2px solid transparent !important;
        border-radius: 50% !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        line-height: 1 !important;
        transition: all 0.2s ease !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1) !important;
        position: relative !important;
        overflow: hidden !important;
        pointer-events: auto !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        opacity: 1 !important;
        visibility: visible !important;
        flex-shrink: 0 !important;
        width: 36px !important;
        height: 36px !important;
        background: #ffffff !important;
      }

      .${BUTTON_CLASS} {
        background: #2563eb !important;
        color: #ffffff !important;
        border-color: #1d4ed8 !important;
      }

      .${BUTTON_CLASS}:hover {
        background: #1d4ed8 !important;
        box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3) !important;
      }

      .${BUTTON_CLASS}:active {
        transform: scale(0.95) !important;
      }

      .${BUTTON_CLASS}.${LISTENING_CLASS} {
        background: #dc2626 !important;
        border-color: #b91c1c !important;
        animation: vtt-pulse 2s ease-in-out infinite !important;
      }

      .${BUTTON_CLASS}.${PROCESSING_CLASS} {
        background: #ea580c !important;
        border-color: #c2410c !important;
        animation: vtt-spin 1s linear infinite !important;
      }

      .${BUTTON_CLASS}.${ERROR_CLASS} {
        background: #991b1b !important;
        border-color: #7f1d1d !important;
        animation: vtt-shake 0.5s ease-in-out !important;
      }

      .${REMOVE_BUTTON_CLASS} {
        background: #6b7280 !important;
        color: #ffffff !important;
        border-color: #4b5563 !important;
        width: 32px !important;
        height: 32px !important;
      }

      .${REMOVE_BUTTON_CLASS}:hover {
        background: #dc2626 !important;
        border-color: #b91c1c !important;
        box-shadow: 0 4px 10px rgba(220, 38, 38, 0.3) !important;
      }

      @keyframes vtt-pulse {
        0%, 100% {
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1), 0 0 0 0 rgba(220, 38, 38, 0.6);
        }
        50% {
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1), 0 0 0 8px rgba(220, 38, 38, 0);
        }
      }

      @keyframes vtt-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes vtt-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      .${BUTTON_CLASS} svg,
      .${REMOVE_BUTTON_CLASS} svg {
        display: block !important;
        pointer-events: none !important;
        width: 18px !important;
        height: 18px !important;
        flex-shrink: 0 !important;
      }

      .${REMOVE_BUTTON_CLASS} svg {
        width: 16px !important;
        height: 16px !important;
      }
    `;

    document.head.appendChild(style);
  }

  static createButtons(element) {
    const container = document.createElement("div");
    container.className = BUTTON_CONTAINER_CLASS;

    const micButton = document.createElement("button");
    micButton.type = "button";
    micButton.className = BUTTON_CLASS;
    micButton.innerHTML = this.getMicIcon();
    micButton.title = DEFAULT_TITLE;
    micButton.setAttribute("aria-label", DEFAULT_TITLE);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = REMOVE_BUTTON_CLASS;
    removeButton.innerHTML = this.getRemoveIcon();
    removeButton.title = REMOVE_TITLE;
    removeButton.setAttribute("aria-label", REMOVE_TITLE);

    micButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleMicClick(element, micButton);
    });

    removeButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.handleRemoveClick(element);
    });

    container.appendChild(micButton);
    container.appendChild(removeButton);

    return { container, micButton, removeButton };
  }

  static handleMicClick(element, button) {
    if (state.activeSession && state.activeSession.element === element) {
      // Stop current session
      state.activeSession.stop();
    } else {
      // Start new session
      if (state.activeSession) {
        state.activeSession.stop();
      }

      try {
        const session = new VoiceRecognitionManager(element, button);
        state.activeSession = session;
        session.start();
      } catch (error) {
        console.error("[VTT] Failed to create session:", error);
        this.showError(button, error.message);
      }
    }
  }

  static handleRemoveClick(element) {
    console.log("[VTT] Remove button clicked");

    if (state.activeSession && state.activeSession.element === element) {
      state.activeSession.stop();
    }

    const buttons = state.buttonMap.get(element);
    if (buttons) {
      buttons.container.remove();
      state.buttonMap.delete(element);
    }
  }

  static setButtonState(button, stateType) {
    button.classList.remove(LISTENING_CLASS, PROCESSING_CLASS, ERROR_CLASS);

    switch (stateType) {
      case "recording":
        button.classList.add(LISTENING_CLASS);
        button.innerHTML = this.getStopIcon();
        button.title = RECORDING_TITLE;
        button.setAttribute("aria-label", RECORDING_TITLE);
        break;

      case "processing":
        button.classList.add(PROCESSING_CLASS);
        button.innerHTML = this.getProcessingIcon();
        button.title = PROCESSING_TITLE;
        button.setAttribute("aria-label", PROCESSING_TITLE);
        break;

      case "error":
        button.classList.add(ERROR_CLASS);
        button.innerHTML = this.getMicIcon();
        break;

      case "idle":
      default:
        button.innerHTML = this.getMicIcon();
        button.title = DEFAULT_TITLE;
        button.setAttribute("aria-label", DEFAULT_TITLE);
        break;
    }
  }

  static showError(button, message) {
    this.setButtonState(button, "error");
    button.title = message;
    button.setAttribute("aria-label", message);

    setTimeout(() => {
      if (!state.activeSession || state.activeSession.button !== button) {
        this.setButtonState(button, "idle");
      }
    }, 3000);
  }

  static getMicIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`;
  }

  static getStopIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>`;
  }

  static getProcessingIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>`;
  }

  static getRemoveIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
  }
}

// ==================== ELEMENT DETECTOR ====================
class ElementDetector {
  static isEligible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.dataset.vttIgnore === "true") return false;

    if (element instanceof HTMLTextAreaElement && state.config.enableTextarea) {
      return true;
    }

    if (element instanceof HTMLInputElement) {
      const inputType = element.type || "text";
      if (state.config.enabledInputTypes.includes(inputType)) {
        return true;
      }
    }

    if (state.config.customSelectors.length > 0) {
      for (const selector of state.config.customSelectors) {
        try {
          if (element.matches(selector)) {
            if (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                TextManager.isContentEditable(element)) {
              return true;
            }
          }
        } catch (e) {
          console.warn("[VTT] Invalid selector:", selector, e);
        }
      }
    }

    return false;
  }

  static attachButtons(element) {
    if (state.buttonMap.has(element)) return;
    if (!state.config.showButtons) return;
    if (!ConfigManager.isSiteAllowed()) return;

    const buttons = UIManager.createButtons(element);
    element.insertAdjacentElement("afterend", buttons.container);
    state.buttonMap.set(element, buttons);

    console.log("[VTT] Buttons attached to:", element.tagName, element.type || "");
  }

  static scanForElements(root) {
    if (!root) return;
    if (!state.config.showButtons) return;
    if (!ConfigManager.isSiteAllowed()) return;
    if (!state.cachedEditableSelector) return;

    if (root instanceof Element && this.isEligible(root)) {
      this.attachButtons(root);
    }

    const nodes = root.querySelectorAll?.(state.cachedEditableSelector) || [];
    for (const node of nodes) {
      if (this.isEligible(node)) {
        this.attachButtons(node);
      }
    }
  }

  static removeButtons(root) {
    if (state.buttonMap.has(root)) {
      const buttons = state.buttonMap.get(root);
      if (state.activeSession && state.activeSession.element === root) {
        state.activeSession.stop();
      }
      buttons.container.remove();
      state.buttonMap.delete(root);
    }

    if (!state.cachedEditableSelector) return;

    const nodes = root.querySelectorAll?.(state.cachedEditableSelector) || [];
    for (const node of nodes) {
      if (state.buttonMap.has(node)) {
        const buttons = state.buttonMap.get(node);
        if (state.activeSession && state.activeSession.element === node) {
          state.activeSession.stop();
        }
        buttons.container.remove();
        state.buttonMap.delete(node);
      }
    }
  }

  static refreshAll() {
    console.log("[VTT] Refreshing all buttons");

    if (!state.config.showButtons || !ConfigManager.isSiteAllowed()) {
      for (const [element] of [...state.buttonMap.entries()]) {
        this.removeButtons(element);
      }
      return;
    }

    for (const [element] of [...state.buttonMap.entries()]) {
      if (!this.isEligible(element)) {
        this.removeButtons(element);
      }
    }

    this.scanForElements(document.body || document);
  }
}

// ==================== MUTATION OBSERVER ====================
function setupMutationObserver() {
  if (state.mutationObserver) return;

  state.mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          ElementDetector.scanForElements(node);
        }
      }

      for (const node of mutation.removedNodes) {
        if (node instanceof Element) {
          ElementDetector.removeButtons(node);
        }
      }
    }
  });

  state.mutationObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

// ==================== STORAGE LISTENER ====================
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;

  let needsRefresh = false;
  let needsRebuild = false;

  if (changes.dictationLanguage) {
    state.config.language = changes.dictationLanguage.newValue;
    console.log("[VTT] Language changed to:", state.config.language);
  }

  if (changes.showVoiceButtons) {
    state.config.showButtons = changes.showVoiceButtons.newValue;
    needsRefresh = true;
  }

  if (changes.enableTextarea) {
    state.config.enableTextarea = changes.enableTextarea.newValue;
    needsRebuild = true;
    needsRefresh = true;
  }

  if (changes.enabledInputTypes) {
    state.config.enabledInputTypes = changes.enabledInputTypes.newValue;
    needsRebuild = true;
    needsRefresh = true;
  }

  if (changes.customSelectors) {
    state.config.customSelectors = ConfigManager.parseMultiline(changes.customSelectors.newValue);
    needsRebuild = true;
    needsRefresh = true;
  }

  if (changes.allowedSites) {
    state.config.allowedSites = ConfigManager.parseMultiline(changes.allowedSites.newValue);
    needsRefresh = true;
  }

  if (needsRebuild) {
    ConfigManager.buildEditableSelector();
  }

  if (needsRefresh) {
    ElementDetector.refreshAll();
  }
});

// ==================== INITIALIZATION ====================
async function initialize() {
  console.log("[VTT] Initializing Voice to Text extension");

  await ConfigManager.load();
  UIManager.initialize();

  if (document.readyState !== "loading") {
    ElementDetector.scanForElements(document.body || document);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      ElementDetector.scanForElements(document.body || document);
    }, { once: true });
  }

  setupMutationObserver();

  console.log("[VTT] Initialization complete");
}

// Start the extension
initialize();
