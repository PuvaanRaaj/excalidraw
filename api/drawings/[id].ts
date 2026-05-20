import {
  ensureDrawingsSchema,
  insertDrawingVersion,
  requireBoolean,
  requireJsonObject,
  requireOptionalString,
  requireString,
  requireStringArray,
  requireUserId,
  requireUuid,
  sendError,
  sql,
} from "../_drawings";

export default async function handler(req: any, res: any) {
  try {
    const ownerId = await requireUserId(req);
    const id = requireUuid(req.query?.id, "Drawing id");

    await ensureDrawingsSchema();

    if (req.method === "GET") {
      const [drawing] = await sql`
        select
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
      const folder = requireOptionalString(req.body?.folder, "folder") ?? null;
      const tags =
        req.body?.tags === undefined
          ? []
          : requireStringArray(req.body.tags, "tags");
      const isStarred =
        typeof req.body?.isStarred === "boolean" ? req.body.isStarred : false;

      const exists = await insertDrawingVersion(id, ownerId);

      if (!exists) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const [drawing] = await sql`
        update drawings
        set
          title = ${title},
          elements = ${JSON.stringify(elements)}::jsonb,
          app_state = ${JSON.stringify(appState)}::jsonb,
          files = ${JSON.stringify(files)}::jsonb,
          folder = ${folder},
          tags = ${tags}::text[],
          is_starred = ${isStarred},
          updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId}
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
        return res.status(404).json({ error: "Drawing not found" });
      }

      return res.status(200).json({ drawing });
    }

    if (req.method === "PATCH") {
      const hasTitle = req.body?.title !== undefined;
      const hasFolder = req.body?.folder !== undefined;
      const hasTags = req.body?.tags !== undefined;
      const hasIsStarred = req.body?.isStarred !== undefined;
      const hasDeleted = req.body?.deleted !== undefined;

      const title = hasTitle
        ? requireString(req.body.title, "Untitled")
        : "Untitled";
      const folder = hasFolder
        ? requireOptionalString(req.body.folder, "folder")
        : null;
      const tags = hasTags ? requireStringArray(req.body.tags, "tags") : [];
      const isStarred = hasIsStarred
        ? requireBoolean(req.body.isStarred, "isStarred")
        : false;
      const deleted = hasDeleted
        ? requireBoolean(req.body.deleted, "deleted")
        : false;

      const [drawing] = await sql`
        update drawings
        set
          title = case when ${hasTitle} then ${title} else title end,
          folder = case when ${hasFolder} then ${folder}::text else folder end,
          tags = case when ${hasTags} then ${tags}::text[] else tags end,
          is_starred = case
            when ${hasIsStarred} then ${isStarred}
            else is_starred
          end,
          deleted_at = case
            when ${hasDeleted} and ${deleted} then coalesce(deleted_at, now())
            when ${hasDeleted} and not ${deleted} then null
            else deleted_at
          end,
          updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId}
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
        return res.status(404).json({ error: "Drawing not found" });
      }

      return res.status(200).json({ drawing });
    }

    if (req.method === "DELETE") {
      const [drawing] = await sql`
        update drawings
        set deleted_at = coalesce(deleted_at, now()), updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId}
        returning id
      `;

      if (!drawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, PUT, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
