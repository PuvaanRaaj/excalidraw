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

import { TTDIndexedDBAdapter } from "../data/TTDStorage";

import "./AI.scss";

type AIProvider = "openai" | "anthropic" | "deepseek";

type AISettings = {
  provider: AIProvider;
  model: string;
  apiKey: string;
};

const AI_SETTINGS_KEY = "excalidraw-ai-settings-v1";

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  deepseek: "deepseek-chat",
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
});

const readAISettings = (): AISettings => {
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) {
      return getDefaultAISettings();
    }

    return {
      ...getDefaultAISettings(),
      ...JSON.parse(raw),
    };
  } catch {
    return getDefaultAISettings();
  }
};

const writeAISettings = (settings: AISettings) => {
  window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
};

const getAIRequestHeaders = () => {
  const settings = readAISettings();

  if (!settings.apiKey.trim()) {
    throw new Error("Add an AI API key from the AI button before using AI.");
  }

  return {
    "X-AI-Provider": settings.provider,
    "X-AI-Model": settings.model || DEFAULT_MODELS[settings.provider],
    "X-AI-API-Key": settings.apiKey.trim(),
  };
};

export const AISettingsButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<AISettings>(getDefaultAISettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(readAISettings());
  }, []);

  const updateSettings = (nextSettings: AISettings) => {
    setSettings(nextSettings);
    setSaved(false);
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
            <span>AI settings</span>
            {saved && <span>Saved</span>}
          </div>
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
              });
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
            value={settings.model}
            onChange={(event) =>
              updateSettings({ ...settings, model: event.target.value })
            }
          />
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
          <button
            className="AISettings__button"
            type="button"
            onClick={() => {
              writeAISettings(settings);
              setSaved(true);
            }}
          >
            Save
          </button>
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
            `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/diagram-to-code/generate`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                ...getAIRequestHeaders(),
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
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            headers: getAIRequestHeaders(),
            signal,
          });

          return result;
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};
