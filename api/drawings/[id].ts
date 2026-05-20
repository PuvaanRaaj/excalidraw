import {
  ensureDrawingsSchema,
  requireJsonObject,
  requireString,
  requireUserId,
  sendError,
  sql,
} from "../_drawings";

export default async function handler(req: any, res: any) {
  try {
    const ownerId = await requireUserId(req);
    const id = requireString(req.query?.id, "");

    if (!id) {
      return res.status(400).json({ error: "Drawing id is required" });
    }

    await ensureDrawingsSchema();

    if (req.method === "GET") {
      const [drawing] = await sql`
        select id, title, elements, app_state, files, created_at, updated_at
        from drawings
        where id = ${id}::uuid and owner_id = ${ownerId}
      `;

      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      return res.status(200).json({ drawing });
    }

    if (req.method === "PUT") {
      const title = requireString(req.body?.title, "Untitled");
      const elements = requireJsonObject(req.body?.elements, []);
      const appState = requireJsonObject(req.body?.appState, {});
      const files = requireJsonObject(req.body?.files, {});

      const [drawing] = await sql`
        update drawings
        set
          title = ${title},
          elements = ${JSON.stringify(elements)}::jsonb,
          app_state = ${JSON.stringify(appState)}::jsonb,
          files = ${JSON.stringify(files)}::jsonb,
          updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId}
        returning id, title, elements, app_state, files, created_at, updated_at
      `;

      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      return res.status(200).json({ drawing });
    }

    if (req.method === "DELETE") {
      await sql`
        delete from drawings
        where id = ${id}::uuid and owner_id = ${ownerId}
      `;

      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
