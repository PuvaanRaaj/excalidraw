import {
  deleteAISettings,
  getPublicAISettings,
  requireUserId,
  saveAISettings,
  sendError,
} from "../_ai.js";

export default async function handler(req: any, res: any) {
  try {
    const ownerId = await requireUserId(req);

    if (req.method === "GET") {
      return res.status(200).json({
        settings: await getPublicAISettings(ownerId),
      });
    }

    if (req.method === "PUT") {
      return res.status(200).json({
        settings: await saveAISettings(ownerId, req.body || {}),
      });
    }

    if (req.method === "DELETE") {
      await deleteAISettings(ownerId);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
