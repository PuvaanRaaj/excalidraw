import {
  requireString,
  requireUserId,
  sendError,
  sql,
} from "./_drawings.js";

export type AIProvider = "openai" | "anthropic" | "deepseek";

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  deepseek: "deepseek-v4-flash",
};

const requireProvider = (value: unknown): AIProvider => {
  if (value === "openai" || value === "anthropic" || value === "deepseek") {
    return value;
  }

  throw Object.assign(
    new Error("provider must be openai, anthropic, or deepseek"),
    {
      statusCode: 400,
    },
  );
};

const getEncryptionKey = async () => {
  const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error("AI_SETTINGS_ENCRYPTION_KEY is not configured");
  }

  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(secret).digest();
};

const encryptApiKey = async (apiKey: string) => {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const key = await getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  };
};

const decryptApiKey = async (encryptedApiKey: {
  iv: string;
  tag: string;
  value: string;
}) => {
  const { createDecipheriv } = await import("node:crypto");
  const key = await getEncryptionKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encryptedApiKey.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encryptedApiKey.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedApiKey.value, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

export const ensureAISettingsSchema = async () => {
  await sql`
    create table if not exists ai_settings (
      owner_id text primary key,
      provider text not null,
      model text not null,
      encrypted_api_key jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
};

export const getPublicAISettings = async (ownerId: string) => {
  await ensureAISettingsSchema();

  const [settings] = await sql`
    select provider, model, updated_at
    from ai_settings
    where owner_id = ${ownerId}
  `;

  if (!settings) {
    return {
      provider: "openai" as AIProvider,
      model: DEFAULT_MODELS.openai,
      hasApiKey: false,
      updated_at: null,
    };
  }

  return {
    provider: settings.provider as AIProvider,
    model: settings.model,
    hasApiKey: true,
    updated_at: settings.updated_at,
  };
};

export const saveAISettings = async (
  ownerId: string,
  body: Record<string, unknown>,
) => {
  await ensureAISettingsSchema();

  const provider = requireProvider(body.provider);
  const model = requireString(body.model, DEFAULT_MODELS[provider]);
  const apiKey = requireString(body.apiKey, "");

  const [existingSettings] = await sql`
    select encrypted_api_key
    from ai_settings
    where owner_id = ${ownerId}
  `;

  if (!apiKey && !existingSettings) {
    throw Object.assign(new Error("apiKey is required"), { statusCode: 400 });
  }

  const encryptedApiKey = apiKey
    ? await encryptApiKey(apiKey)
    : existingSettings.encrypted_api_key;

  await sql`
    insert into ai_settings (owner_id, provider, model, encrypted_api_key)
    values (
      ${ownerId},
      ${provider},
      ${model},
      ${JSON.stringify(encryptedApiKey)}::jsonb
    )
    on conflict (owner_id)
    do update set
      provider = excluded.provider,
      model = excluded.model,
      encrypted_api_key = excluded.encrypted_api_key,
      updated_at = now()
  `;

  return getPublicAISettings(ownerId);
};

export const deleteAISettings = async (ownerId: string) => {
  await ensureAISettingsSchema();
  await sql`
    delete from ai_settings
    where owner_id = ${ownerId}
  `;
};

export const requireAIBackendSettings = async (req: any) => {
  const ownerId = await requireUserId(req);
  await ensureAISettingsSchema();

  const [settings] = await sql`
    select provider, model, encrypted_api_key
    from ai_settings
    where owner_id = ${ownerId}
  `;

  if (!settings) {
    throw Object.assign(new Error("AI settings are not configured"), {
      statusCode: 400,
    });
  }

  return {
    provider: settings.provider as AIProvider,
    model: settings.model as string,
    apiKey: await decryptApiKey(settings.encrypted_api_key),
  };
};

export const aiHeaders = (settings: {
  provider: AIProvider;
  model: string;
  apiKey: string;
}) => ({
  "X-AI-Provider": settings.provider,
  "X-AI-Model": settings.model,
  "X-AI-API-Key": settings.apiKey,
});

type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

type AISettings = {
  provider: AIProvider;
  model: string;
  apiKey: string;
};

const TEXT_TO_DIAGRAM_SYSTEM_PROMPT = [
  "You convert user requests into Mermaid diagrams for Excalidraw.",
  "Return only valid Mermaid code.",
  "Do not wrap the answer in markdown fences.",
  "Prefer flowchart, sequenceDiagram, classDiagram, stateDiagram, or erDiagram when appropriate.",
].join(" ");

const DIAGRAM_TO_CODE_SYSTEM_PROMPT = [
  "You convert a sketch or wireframe image into clean, self-contained HTML.",
  "Return only the HTML document.",
  "Use inline CSS. Do not include markdown fences or explanations.",
].join(" ");

const parseProviderError = async (response: Response) => {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return (
      json.error?.message ||
      json.message ||
      `AI provider request failed (${response.status})`
    );
  } catch {
    return text || `AI provider request failed (${response.status})`;
  }
};

const stripMarkdownFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:html|mermaid)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const toOpenAICompatibleMessages = (
  systemPrompt: string,
  messages: readonly LLMMessage[],
) => [
  { role: "system", content: systemPrompt },
  ...messages.map((message) => ({
    role: message.role,
    content: message.content,
  })),
];

const callOpenAICompatibleText = async (
  settings: AISettings,
  systemPrompt: string,
  messages: readonly LLMMessage[],
  endpoint: string,
) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      messages: toOpenAICompatibleMessages(systemPrompt, messages),
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(await parseProviderError(response)), {
      statusCode: response.status,
    });
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("AI provider returned an empty response");
  }

  return stripMarkdownFences(content);
};

const callAnthropicText = async (
  settings: AISettings,
  systemPrompt: string,
  messages: readonly LLMMessage[],
) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(await parseProviderError(response)), {
      statusCode: response.status,
    });
  }

  const data = await response.json();
  const content = (data.content || [])
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("");

  if (!content) {
    throw new Error("AI provider returned an empty response");
  }

  return stripMarkdownFences(content);
};

export const generateTextToDiagram = async (
  settings: AISettings,
  messages: readonly LLMMessage[],
) => {
  if (settings.provider === "anthropic") {
    return callAnthropicText(settings, TEXT_TO_DIAGRAM_SYSTEM_PROMPT, messages);
  }

  return callOpenAICompatibleText(
    settings,
    TEXT_TO_DIAGRAM_SYSTEM_PROMPT,
    messages,
    settings.provider === "deepseek"
      ? "https://api.deepseek.com/chat/completions"
      : "https://api.openai.com/v1/chat/completions",
  );
};

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw Object.assign(new Error("image must be a base64 data URL"), {
      statusCode: 400,
    });
  }

  return {
    mediaType: match[1],
    base64: match[2],
  };
};

export const generateDiagramHTML = async (
  settings: AISettings,
  body: Record<string, unknown>,
) => {
  const image = requireString(body.image, "");
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((text) => typeof text === "string").join("\n")
    : requireString(body.texts, "");
  const theme = requireString(body.theme, "light");

  if (!image) {
    throw Object.assign(new Error("image is required"), { statusCode: 400 });
  }

  if (settings.provider === "deepseek") {
    throw Object.assign(
      new Error("DeepSeek does not support image-to-code in this integration"),
      { statusCode: 400 },
    );
  }

  const userText = [
    `Theme: ${theme}`,
    texts ? `Text found in the diagram:\n${texts}` : "",
    "Generate a faithful HTML/CSS implementation of this drawing.",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (settings.provider === "anthropic") {
    const { mediaType, base64 } = parseDataUrl(image);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 4096,
        system: DIAGRAM_TO_CODE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw Object.assign(new Error(await parseProviderError(response)), {
        statusCode: response.status,
      });
    }

    const data = await response.json();
    const html = (data.content || [])
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");

    if (!html) {
      throw new Error("AI provider returned an empty response");
    }

    return stripMarkdownFences(html);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: DIAGRAM_TO_CODE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(await parseProviderError(response)), {
      statusCode: response.status,
    });
  }

  const data = await response.json();
  const html = data.choices?.[0]?.message?.content;

  if (!html) {
    throw new Error("AI provider returned an empty response");
  }

  return stripMarkdownFences(html);
};

export { requireUserId, sendError };
