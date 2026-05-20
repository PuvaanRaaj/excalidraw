import {
  generateDiagramHTML,
  requireAIBackendSettings,
  sendError,
} from "../../_ai.js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const settings = await requireAIBackendSettings(req);
    const html = await generateDiagramHTML(settings, req.body || {});

    return res.status(200).json({ html });
  } catch (error) {
    return sendError(res, error);
  }
}
