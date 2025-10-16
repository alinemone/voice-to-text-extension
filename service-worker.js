chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["geminiModel"], ({ geminiModel }) => {
    if (!geminiModel) {
      chrome.storage.local.set({ geminiModel: "models/gemini-1.5-flash-latest" });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "generate") {
    handleGenerateRequest(message.payload)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || "Unexpected error" });
      });
    return true;
  }
  if (message?.type === "listModels") {
    handleListModels()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || "Unexpected error" });
      });
    return true;
  }
  return false;
});

async function handleGenerateRequest(payload) {
  if (!payload) {
    return { ok: false, error: "Missing payload" };
  }

  const { geminiApiKey, systemRole } = await chrome.storage.local.get([
    "geminiApiKey",
    "systemRole"
  ]);
  if (!geminiApiKey) {
    return { ok: false, error: "API token not saved." };
  }

  const { model, contents } = payload;
  if (!model || !Array.isArray(contents) || contents.length === 0) {
    return { ok: false, error: "Conversation is empty." };
  }

  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`);
  endpoint.searchParams.set("key", geminiApiKey);

  const requestBody = { contents };
  if (typeof systemRole === "string" && systemRole.trim().length > 0) {
    requestBody.systemInstruction = {
      role: "system",
      parts: [{ text: systemRole.trim() }]
    };
  }

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false,
      error: `Gemini error: ${response.status} ${response.statusText} ${errorText}`.trim()
    };
  }

  const data = await response.json();
  const text = (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join(" ")
    .trim();

  if (!text) {
    return { ok: false, error: "Gemini returned no text." };
  }

  return {
    ok: true,
    text,
    raw: data
  };
}

async function handleListModels() {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    return { ok: false, error: "API token not saved." };
  }

  const endpoint = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  endpoint.searchParams.set("key", geminiApiKey);
  endpoint.searchParams.set("pageSize", "200");

  const response = await fetch(endpoint.toString(), {
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false,
      error: `Model list error: ${response.status} ${response.statusText} ${errorText}`.trim()
    };
  }

  const data = await response.json();
  const models = (data.models || [])
    .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => model.name)
    .filter(Boolean);

  if (models.length === 0) {
    return { ok: false, error: "No Gemini models returned." };
  }

  return { ok: true, models };
}
