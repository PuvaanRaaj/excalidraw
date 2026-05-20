import {
  ensureDrawingsSchema,
  insertDrawingVersion,
  requireString,
  requireUserId,
  requireUuid,
  sendError,
  sql,
} from "../../_drawings";

export default async function handler(req: any, res: any) {
  try {
    const ownerId = await requireUserId(req);
    const drawingId = requireUuid(req.query?.id, "Drawing id");

    await ensureDrawingsSchema();

    const [drawing] = await sql`
      select id
      from drawings
      where id = ${drawingId}::uuid and owner_id = ${ownerId}
    `;

    if (!drawing) {
      return res.status(404).json({ error: "Drawing not found" });
    }

    if (req.method === "GET") {
      const versions = await sql`
        select id, drawing_id, owner_id, title, created_at
        from drawing_versions
        where drawing_id = ${drawingId}::uuid and owner_id = ${ownerId}
        order by created_at desc
      `;

      return res.status(200).json({ versions });
    }

    if (req.method === "POST") {
      const versionId = requireUuid(
        requireString(req.body?.versionId, ""),
        "versionId",
      );
      const [version] = await sql`
        select title, elements, app_state, files
        from drawing_versions
        where
          id = ${versionId}::uuid
          and drawing_id = ${drawingId}::uuid
          and owner_id = ${ownerId}
      `;

      if (!version) {
        return res.status(404).json({ error: "Version not found" });
      }

      await insertDrawingVersion(drawingId, ownerId);

      const [restoredDrawing] = await sql`
        update drawings
        set
          title = ${version.title},
          elements = ${JSON.stringify(version.elements)}::jsonb,
          app_state = ${JSON.stringify(version.app_state)}::jsonb,
          files = ${JSON.stringify(version.files)}::jsonb,
          updated_at = now()
        where id = ${drawingId}::uuid and owner_id = ${ownerId}
        returning
          id,
          title,
          elements,
          app_state,
          files,
          folder,
          tags,
          is_starred,
          deleted_at,
          created_at,
          updated_at
      `;

      return res.status(200).json({ drawing: restoredDrawing });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
