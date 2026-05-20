import {
  ensureDrawingsSchema,
  insertDrawingVersion,
  requireJsonObject,
  requireString,
  requireUuid,
  sendError,
  sql,
} from "../_drawings.js";

export default async function handler(req: any, res: any) {
  try {
    const shareId = requireUuid(req.query?.shareId, "shareId");

    await ensureDrawingsSchema();

    if (req.method === "GET") {
      const [sharedDrawing] = await sql`
        select
          drawing_shares.id as share_id,
          drawing_shares.permission,
          drawings.id,
          drawings.title,
          drawings.elements,
          drawings.app_state,
          drawings.files,
          drawings.folder,
          drawings.tags,
          drawings.is_starred,
          drawings.deleted_at,
          drawings.created_at,
          drawings.updated_at
        from drawing_shares
        join drawings on drawings.id = drawing_shares.drawing_id
        where drawing_shares.id = ${shareId}::uuid
          and drawings.deleted_at is null
      `;

      if (!sharedDrawing) {
        return res.status(404).json({ error: "Shared drawing not found" });
      }

      const {
        permission,
        share_id: returnedShareId,
        ...drawing
      } = sharedDrawing;

      return res.status(200).json({
        share: { id: returnedShareId, permission },
        drawing,
      });
    }

    if (req.method === "PUT") {
      const title = requireString(req.body?.title, "Untitled");
      const elements = requireJsonObject(req.body?.elements, []);
      const appState = requireJsonObject(req.body?.appState, {});
      const files = requireJsonObject(req.body?.files, {});

      const [share] = await sql`
        select
          drawing_shares.drawing_id,
          drawing_shares.owner_id,
          drawing_shares.permission
        from drawing_shares
        join drawings on drawings.id = drawing_shares.drawing_id
        where drawing_shares.id = ${shareId}::uuid
          and drawings.deleted_at is null
      `;

      if (!share) {
        return res.status(404).json({ error: "Shared drawing not found" });
      }

      if (share.permission !== "edit") {
        return res.status(403).json({ error: "Share is view-only" });
      }

      const exists = await insertDrawingVersion(
        share.drawing_id,
        share.owner_id,
      );

      if (!exists) {
        return res.status(404).json({ error: "Shared drawing not found" });
      }

      const [drawing] = await sql`
        update drawings
        set
          title = ${title},
          elements = ${JSON.stringify(elements)}::jsonb,
          app_state = ${JSON.stringify(appState)}::jsonb,
          files = ${JSON.stringify(files)}::jsonb,
          updated_at = now()
        where id = ${share.drawing_id}::uuid
          and owner_id = ${share.owner_id}
          and deleted_at is null
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

      if (!drawing) {
        return res.status(404).json({ error: "Shared drawing not found" });
      }

      return res.status(200).json({
        share: { id: shareId, permission: share.permission },
        drawing,
      });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
