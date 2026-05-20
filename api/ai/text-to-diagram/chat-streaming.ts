import {
  generateTextToDiagram,
  requireAIBackendSettings,
  sendError,
} from "../../_ai.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const settings = await requireAIBackendSettings(req);
    const content = await generateTextToDiagram(
      settings,
      req.body?.messages || [],
    );

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.write(
      `data: ${JSON.stringify({ type: "content", delta: content })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    return res.end();
  } catch (error) {
    return sendError(res, error);
  }
}
