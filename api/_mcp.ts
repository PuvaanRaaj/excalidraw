import { sendError, sql } from "./_drawings.js";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

const MAX_COMMANDS_PER_SESSION = 100;

export const ensureMcpSchema = async () => {
  await sql`
    create extension if not exists pgcrypto;
  `;
  await sql`
    create table if not exists mcp_canvas_commands (
      id uuid primary key default gen_random_uuid(),
      session_id text not null,
      command jsonb not null,
      delivered_at timestamptz,
      created_at timestamptz not null default now()
    );
  `;
  await sql`
    create index if not exists mcp_canvas_commands_session_created_idx
      on mcp_canvas_commands (session_id, created_at desc);
  `;
  await sql`
    create index if not exists mcp_canvas_commands_pending_idx
      on mcp_canvas_commands (session_id, delivered_at, created_at asc);
  `;
};

export const requireMcpAuth = (req: any) => {
  const expectedToken = process.env.MCP_CONNECTOR_TOKEN;

  if (!expectedToken) {
    return;
  }

  const authorization = req.headers.authorization;
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  if (token !== expectedToken) {
    throw Object.assign(new Error("Invalid MCP authorization token"), {
      statusCode: 401,
    });
  }
};

export const requireSessionId = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw Object.assign(new Error("sessionId must be 8-80 URL-safe chars"), {
      statusCode: 400,
    });
  }

  return value;
};

export const queueCanvasCommand = async (
  sessionId: string,
  command: Record<string, unknown>,
) => {
  await ensureMcpSchema();
  await sql`
    insert into mcp_canvas_commands (session_id, command)
    values (${sessionId}, ${JSON.stringify(command)}::jsonb)
  `;
  await sql`
    delete from mcp_canvas_commands
    where id in (
      select id
      from mcp_canvas_commands
      where session_id = ${sessionId}
      order by created_at desc
      offset ${MAX_COMMANDS_PER_SESSION}
    )
  `;
};

const jsonRpcResult = (id: JsonRpcRequest["id"], result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result,
});

const jsonRpcError = (
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const textToolResult = (text: string) => ({
  content: [{ type: "text", text }],
});

const tools = [
  {
    name: "draw_excalidraw",
    description:
      "Draw a structured diagram into the user's currently open Excalidraw canvas. Ask the user for their MCP session id from the Excalidraw MCP button before using this tool.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: {
          type: "string",
          description: "The session id shown in the Excalidraw MCP panel.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          default: "append",
          description:
            "append keeps existing canvas content; replace clears it first.",
        },
        title: {
          type: "string",
          description: "Optional title shown in the bridge activity log.",
        },
        elements: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          description:
            "Diagram nodes to draw. Use absolute canvas coordinates; if unsure, start near x=0 y=0 and lay out left-to-right or top-to-bottom.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description:
                  "Stable id used by connectors, e.g. start, auth, database.",
              },
              type: {
                type: "string",
                enum: ["rectangle", "diamond", "ellipse", "text"],
                default: "rectangle",
              },
              label: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number", default: 180 },
              height: { type: "number", default: 80 },
              strokeColor: { type: "string", default: "#1e1e1e" },
              backgroundColor: { type: "string", default: "transparent" },
            },
            required: ["id", "label", "x", "y"],
          },
        },
        connectors: {
          type: "array",
          maxItems: 120,
          description: "Arrows between node ids.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
            },
            required: ["from", "to"],
          },
        },
      },
      required: ["sessionId", "elements"],
    },
  },
  {
    name: "clear_excalidraw",
    description:
      "Clear the user's currently open Excalidraw canvas for a given MCP session id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: {
          type: "string",
          description: "The session id shown in the Excalidraw MCP panel.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "get_excalidraw_session",
    description:
      "Check whether a session id has recent queued commands for the Excalidraw canvas bridge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: {
          type: "string",
          description: "The session id shown in the Excalidraw MCP panel.",
        },
      },
      required: ["sessionId"],
    },
  },
];

const handleToolCall = async (name: string, args: Record<string, unknown>) => {
  if (name === "draw_excalidraw") {
    const sessionId = requireSessionId(args.sessionId);
    const elements = Array.isArray(args.elements) ? args.elements : [];

    if (!elements.length) {
      throw Object.assign(new Error("elements must contain at least one item"), {
        statusCode: 400,
      });
    }

    await queueCanvasCommand(sessionId, {
      type: "draw",
      mode: args.mode === "replace" ? "replace" : "append",
      title: typeof args.title === "string" ? args.title : "",
      elements,
      connectors: Array.isArray(args.connectors) ? args.connectors : [],
    });

    return textToolResult(
      `Queued ${elements.length} elements for Excalidraw session ${sessionId}.`,
    );
  }

  if (name === "clear_excalidraw") {
    const sessionId = requireSessionId(args.sessionId);
    await queueCanvasCommand(sessionId, { type: "clear" });
    return textToolResult(`Queued canvas clear for session ${sessionId}.`);
  }

  if (name === "get_excalidraw_session") {
    const sessionId = requireSessionId(args.sessionId);
    await ensureMcpSchema();
    const [summary] = await sql`
      select
        count(*)::int as total,
        count(*) filter (where delivered_at is null)::int as pending,
        max(created_at) as last_command_at
      from mcp_canvas_commands
      where session_id = ${sessionId}
    `;

    return textToolResult(JSON.stringify(summary || {}, null, 2));
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 404 });
};

export const handleMcpRequest = async (req: any, res: any) => {
  try {
    requireMcpAuth(req);

    if (req.method === "GET") {
      return res.status(200).json({
        name: "Excalidraw Canvas MCP",
        description:
          "Remote MCP server for drawing into a live Excalidraw browser canvas.",
        protocol: "mcp",
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body as JsonRpcRequest;

    if (!body?.id && body?.method?.startsWith("notifications/")) {
      return res.status(204).end();
    }

    if (body.method === "initialize") {
      return res.status(200).json(
        jsonRpcResult(body.id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "excalidraw-canvas",
            version: "0.1.0",
          },
        }),
      );
    }

    if (body.method === "ping") {
      return res.status(200).json(jsonRpcResult(body.id, {}));
    }

    if (body.method === "tools/list") {
      return res.status(200).json(jsonRpcResult(body.id, { tools }));
    }

    if (body.method === "tools/call") {
      const name = String(body.params?.name || "");
      const args =
        body.params?.arguments && typeof body.params.arguments === "object"
          ? body.params.arguments
          : {};

      const result = await handleToolCall(name, args);
      return res.status(200).json(jsonRpcResult(body.id, result));
    }

    if (body.method === "resources/list" || body.method === "prompts/list") {
      const key = body.method === "resources/list" ? "resources" : "prompts";
      return res.status(200).json(jsonRpcResult(body.id, { [key]: [] }));
    }

    return res
      .status(200)
      .json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
  } catch (error: any) {
    if (req.body?.id) {
      return res
        .status(200)
        .json(jsonRpcError(req.body.id, -32000, error.message || "MCP error"));
    }

    return sendError(res, error);
  }
};
