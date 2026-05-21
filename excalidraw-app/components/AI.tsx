import {
  DiagramToCodePlugin,
  exportToBlob,
  getTextFromElements,
  MIME_TYPES,
  TTDDialog,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { safelyParseJSON } from "@excalidraw/common";
import { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { cloudAuth } from "../cloud/auth";
import { TTDIndexedDBAdapter } from "../data/TTDStorage";

import "./AI.scss";

type AIProvider = "openai" | "anthropic" | "deepseek";

type AISettings = {
  provider: AIProvider;
  model: string;
  apiKey: string;
  hasApiKey?: boolean;
};

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  deepseek: "deepseek-v4-flash",
};

const MODEL_OPTIONS: Record<AIProvider, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  anthropic: [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
};

const getDefaultAISettings = (): AISettings => ({
  provider: "openai",
  model: DEFAULT_MODELS.openai,
  apiKey: "",
  hasApiKey: false,
});

const getAIAuthHeaders = async () => {
  if (!cloudAuth) {
    throw new Error("Sign in is required before using AI.");
  }

  const token = await cloudAuth.getJWTToken();

  if (!token) {
    throw new Error("Sign in before using AI.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const aiFetch = async <T,>(path: string, init: RequestInit = {}) => {
  const authHeaders = await getAIAuthHeaders();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return text ? { error: text } : null;
    });
    throw new Error(body?.error || `AI request failed (${response.status})`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
};

const loadAISettings = async () => {
  const data = await aiFetch<{
    settings: {
      provider: AIProvider;
      model: string;
      hasApiKey: boolean;
    };
  }>("/api/ai/settings");

  return {
    ...getDefaultAISettings(),
    ...data.settings,
    apiKey: "",
  };
};

const saveAISettings = async (settings: AISettings) => {
  const data = await aiFetch<{
    settings: {
      provider: AIProvider;
      model: string;
      hasApiKey: boolean;
    };
  }>("/api/ai/settings", {
    method: "PUT",
    body: JSON.stringify({
      provider: settings.provider,
      model: settings.model || DEFAULT_MODELS[settings.provider],
      apiKey: settings.apiKey,
    }),
  });

  return {
    ...getDefaultAISettings(),
    ...data.settings,
    apiKey: "",
  };
};

export const AISettingsButton = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<AISettings>(getDefaultAISettings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isEditingKey, setIsEditingKey] = useState(false);

  useEffect(() => {
    localStorage.removeItem("excalidraw-ai-settings-v1");

    if (isOpen) {
      loadAISettings()
        .then((nextSettings) => {
          setSettings(nextSettings);
          setError("");
          setIsEditingKey(!nextSettings.hasApiKey);
        })
        .catch((error: Error) => setError(error.message));
    }
  }, [isOpen]);

  const openTextToDiagram = (tab: "text-to-diagram" | "mermaid") => {
    excalidrawAPI.updateScene({
      appState: {
        openDialog: { name: "ttd", tab },
      } as any,
    });
    setIsOpen(false);
  };

  const handleSave = async () => {
    setError("");
    setMessage("Saving...");

    try {
      const nextSettings = await saveAISettings(settings);
      setSettings(nextSettings);
      setIsEditingKey(false);
      setMessage("Saved");
    } catch (error: any) {
      setError(error.message || "AI settings save failed");
      setMessage("");
    }
  };

  const handleClear = async () => {
    setError("");
    setMessage("Removing...");

    try {
      await aiFetch<null>("/api/ai/settings", { method: "DELETE" });
      setSettings(getDefaultAISettings());
      setIsEditingKey(true);
      setMessage("Removed");
    } catch (error: any) {
      setError(error.message || "AI settings remove failed");
      setMessage("");
    }
  };

  const updateSettings = (nextSettings: AISettings) => {
    setSettings(nextSettings);
    setMessage("");
  };

  return (
    <div
      className="AISettings"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <button
        className="AISettings__toggle"
        type="button"
        onClick={() => setIsOpen((value) => !value)}
      >
        AI
      </button>
      {isOpen && (
        <div className="AISettings__panel">
          <div className="AISettings__header">
            <span>AI</span>
            {message && <span>{message}</span>}
          </div>
          <div className="AISettings__actions">
            <button
              className="AISettings__button"
              type="button"
              onClick={() => openTextToDiagram("text-to-diagram")}
            >
              Text to diagram
            </button>
            <button
              className="AISettings__button"
              type="button"
              onClick={() => openTextToDiagram("mermaid")}
            >
              Mermaid
            </button>
          </div>
          <div className="AISettings__subheader">Provider settings</div>
          {settings.hasApiKey && !isEditingKey && (
            <div className="AISettings__connected">
              <span>Connected</span>
              <button type="button" onClick={() => setIsEditingKey(true)}>
                Change key
              </button>
            </div>
          )}
          <label className="AISettings__label" htmlFor="ai-provider">
            Provider
          </label>
          <select
            id="ai-provider"
            className="AISettings__input"
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as AIProvider;
              updateSettings({
                ...settings,
                provider,
                model: DEFAULT_MODELS[provider],
                hasApiKey: provider === settings.provider && settings.hasApiKey,
              });
              setIsEditingKey(provider !== settings.provider);
            }}
          >
            {(["openai", "anthropic", "deepseek"] as const).map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
          <label className="AISettings__label" htmlFor="ai-model">
            Model
          </label>
          <input
            id="ai-model"
            className="AISettings__input"
            list={`ai-model-options-${settings.provider}`}
            value={settings.model}
            onChange={(event) =>
              updateSettings({ ...settings, model: event.target.value })
            }
          />
          <datalist id={`ai-model-options-${settings.provider}`}>
            {MODEL_OPTIONS[settings.provider].map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {(!settings.hasApiKey || isEditingKey) && (
            <>
              <label className="AISettings__label" htmlFor="ai-api-key">
                API key
              </label>
              <input
                id="ai-api-key"
                className="AISettings__input"
                type="password"
                placeholder={`${PROVIDER_LABELS[settings.provider]} API key`}
                value={settings.apiKey}
                onChange={(event) =>
                  updateSettings({ ...settings, apiKey: event.target.value })
                }
              />
              {settings.hasApiKey && (
                <div className="AISettings__hint">
                  Leave blank to keep the saved encrypted key.
                </div>
              )}
            </>
          )}
          {error && <div className="AISettings__error">{error}</div>}
          <div className="AISettings__actions">
            <button
              className="AISettings__button"
              type="button"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              className="AISettings__button AISettings__button--secondary"
              type="button"
              onClick={handleClear}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  return (
    <>
      <DiagramToCodePlugin
        generate={async ({ frame, children }) => {
          const appState = excalidrawAPI.getAppState();

          const blob = await exportToBlob({
            elements: children,
            appState: {
              ...appState,
              exportBackground: true,
              viewBackgroundColor: appState.viewBackgroundColor,
            },
            exportingFrame: frame,
            files: excalidrawAPI.getFiles(),
            mimeType: MIME_TYPES.jpg,
          });

          const dataURL = await getDataURL(blob);

          const textFromFrameChildren = getTextFromElements(children);

          const response = await fetch(
            "/api/ai/diagram-to-code/generate",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                ...(await getAIAuthHeaders()),
              },
              body: JSON.stringify({
                texts: textFromFrameChildren,
                image: dataURL,
                theme: appState.theme,
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            const errorJSON = safelyParseJSON(text);

            if (!errorJSON) {
              throw new Error(text);
            }

            if (errorJSON.statusCode === 429) {
              return {
                html: `<html>
                <body style="margin: 0; text-align: center">
                <div style="display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100vh; padding: 0 60px">
                  <div style="color:red">Too many requests today,</br>please try again tomorrow!</div>
                  </br>
                  </br>
                  <div>Your AI request limit has been reached.</div>
                </div>
                </body>
                </html>`,
              };
            }

            throw new Error(errorJSON.message || text);
          }

          try {
            const { html } = await response.json();

            if (!html) {
              throw new Error("Generation failed (invalid response)");
            }
            return {
              html,
            };
          } catch (error: any) {
            throw new Error("Generation failed (invalid response)");
          }
        }}
      />

      <TTDDialog
        onTextSubmit={async (props) => {
          const { onChunk, onStreamCreated, signal, messages } = props;

          const result = await TTDStreamFetch({
            url: "/api/ai/text-to-diagram/chat-streaming",
            messages,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            headers: await getAIAuthHeaders(),
            signal,
          });

          return result;
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};
