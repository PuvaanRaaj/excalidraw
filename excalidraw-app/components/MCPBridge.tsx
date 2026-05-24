import {
  newArrowElement,
  newElement,
  newTextElement,
} from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useEffect, useMemo, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./MCPBridge.scss";

type McpNode = {
  id: string;
  type?: "rectangle" | "diamond" | "ellipse" | "text";
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  strokeColor?: string;
  backgroundColor?: string;
};

type McpConnector = {
  from: string;
  to: string;
  label?: string;
};

type McpCommand = {
  id: string;
  command: {
    type?: "draw" | "clear";
    mode?: "append" | "replace";
    title?: string;
    elements?: McpNode[];
    connectors?: McpConnector[];
  };
};

const SESSION_STORAGE_KEY = "excalidraw-mcp-session-id-v1";

const makeSessionId = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const getSessionId = () => {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const sessionId = makeSessionId();
  localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
};

const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const makeNodeElements = (node: McpNode) => {
  const x = toFiniteNumber(node.x, 0);
  const y = toFiniteNumber(node.y, 0);
  const width = Math.max(40, toFiniteNumber(node.width, 180));
  const height = Math.max(30, toFiniteNumber(node.height, 80));
  const strokeColor = node.strokeColor || "#f8f9fa";
  const backgroundColor = node.backgroundColor || "transparent";
  const type = node.type || "rectangle";

  if (type === "text") {
    return [
      newTextElement({
        x,
        y,
        text: node.label,
        strokeColor,
        backgroundColor: "transparent",
        fontSize: 22,
      }),
    ];
  }

  const shape = newElement({
    type,
    x,
    y,
    width,
    height,
    strokeColor,
    backgroundColor,
    strokeWidth: 2,
    roughness: 1,
  });
  const label = newTextElement({
    x: x + width / 2,
    y: y + height / 2,
    text: node.label,
    strokeColor,
    backgroundColor: "transparent",
    fontSize: 18,
    textAlign: "center",
    verticalAlign: "middle",
  });

  return [shape, label];
};

const getNodeCenter = (node: McpNode) => ({
  x: toFiniteNumber(node.x, 0) + Math.max(40, toFiniteNumber(node.width, 180)) / 2,
  y:
    toFiniteNumber(node.y, 0) + Math.max(30, toFiniteNumber(node.height, 80)) / 2,
});

const makeConnectorElements = (
  connector: McpConnector,
  nodeMap: Map<string, McpNode>,
) => {
  const from = nodeMap.get(connector.from);
  const to = nodeMap.get(connector.to);

  if (!from || !to) {
    return [];
  }

  const start = getNodeCenter(from);
  const end = getNodeCenter(to);
  const arrow = newArrowElement({
    type: "arrow",
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ] as any,
    strokeColor: from.strokeColor || "#f8f9fa",
    backgroundColor: "transparent",
    strokeWidth: 2,
    endArrowhead: "arrow",
  });
  const elements: ExcalidrawElement[] = [arrow as ExcalidrawElement];

  if (connector.label) {
    elements.push(
      newTextElement({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - 16,
        text: connector.label,
        strokeColor: "#f8f9fa",
        backgroundColor: "transparent",
        fontSize: 14,
        textAlign: "center",
      }) as ExcalidrawElement,
    );
  }

  return elements;
};

const commandToElements = (command: McpCommand["command"]) => {
  const nodes = Array.isArray(command.elements) ? command.elements : [];
  const connectors = Array.isArray(command.connectors)
    ? command.connectors
    : [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return [
    ...nodes.flatMap(makeNodeElements),
    ...connectors.flatMap((connector) =>
      makeConnectorElements(connector, nodeMap),
    ),
  ] as ExcalidrawElement[];
};

export const MCPBridge = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const sessionId = useMemo(getSessionId, []);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("Ready");
  const [lastCommandAt, setLastCommandAt] = useState("");

  useEffect(() => {
    let isCancelled = false;
    let timeout: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/mcp/commands?sessionId=${encodeURIComponent(sessionId)}`,
        );

        if (!response.ok) {
          throw new Error(`MCP polling failed (${response.status})`);
        }

        const data = (await response.json()) as { commands?: McpCommand[] };
        const commands = data.commands || [];

        for (const item of commands) {
          if (item.command.type === "clear") {
            excalidrawAPI.updateScene({
              elements: [],
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            setMessage("Canvas cleared by MCP");
            continue;
          }

          if (item.command.type === "draw") {
            const nextElements = commandToElements(item.command);
            const currentElements =
              item.command.mode === "replace"
                ? []
                : excalidrawAPI.getSceneElementsIncludingDeleted();

            excalidrawAPI.updateScene({
              elements: [...currentElements, ...nextElements],
              appState: {
                selectedElementIds: Object.fromEntries(
                  nextElements.map((element) => [element.id, true]),
                ),
              },
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            excalidrawAPI.scrollToContent(nextElements, { animate: true });
            setMessage(
              item.command.title
                ? `Drew ${item.command.title}`
                : `Drew ${nextElements.length} items`,
            );
          }
        }

        if (commands.length) {
          setLastCommandAt(new Date().toLocaleTimeString());
        }
      } catch (error: any) {
        setMessage(error.message || "MCP disconnected");
      } finally {
        if (!isCancelled) {
          timeout = window.setTimeout(poll, 1500);
        }
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [excalidrawAPI, sessionId]);

  const copySessionId = async () => {
    await navigator.clipboard.writeText(sessionId);
    setMessage("Session copied");
  };

  return (
    <div className="MCPBridge">
      <button
        className="MCPBridge__toggle"
        type="button"
        onClick={() => setIsOpen((value) => !value)}
      >
        MCP
      </button>
      {isOpen && (
        <div className="MCPBridge__panel">
          <div className="MCPBridge__header">
            <span>Canvas MCP</span>
            <span>{message}</span>
          </div>
          <label className="MCPBridge__label" htmlFor="mcp-session-id">
            Session id
          </label>
          <input
            id="mcp-session-id"
            className="MCPBridge__input"
            value={sessionId}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="MCPBridge__actions">
            <button
              className="MCPBridge__button MCPBridge__button--primary"
              type="button"
              onClick={copySessionId}
            >
              Copy session
            </button>
          </div>
          <div className="MCPBridge__hint">
            MCP URL: {window.location.origin}/api/mcp
          </div>
          {lastCommandAt && (
            <div className="MCPBridge__hint">Last command: {lastCommandAt}</div>
          )}
        </div>
      )}
    </div>
  );
};
