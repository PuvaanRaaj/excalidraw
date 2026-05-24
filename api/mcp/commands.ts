import {
  ensureMcpSchema,
  requireSessionId,
  queueCanvasCommand,
} from "../_mcp.js";
import { sendError, sql } from "../_drawings.js";

export default async function handler(req: any, res: any) {
  try {
    await ensureMcpSchema();

    if (req.method === "GET") {
      const sessionId = requireSessionId(req.query?.sessionId);
      const commands = await sql`
        update mcp_canvas_commands
        set delivered_at = now()
        where id in (
          select id
          from mcp_canvas_commands
          where session_id = ${sessionId}
            and delivered_at is null
          order by created_at asc
          limit 20
        )
        returning id, command, created_at
      `;

      return res.status(200).json({ commands });
    }

    if (req.method === "POST") {
      const sessionId = requireSessionId(req.body?.sessionId);
      await queueCanvasCommand(sessionId, req.body?.command || {});
      return res.status(202).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
