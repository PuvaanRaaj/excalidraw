import {
  ensureDrawingsSchema,
  requireJsonObject,
  requireOptionalString,
  requireString,
  requireStringArray,
  requireUserId,
  sendError,
  sql,
} from "../_drawings";

export default async function handler(req: any, res: any) {
  try {
    const ownerId = await requireUserId(req);
    await ensureDrawingsSchema();

    if (req.method === "GET") {
      const showTrash = req.query?.trash === "1" || req.query?.trash === "true";
      const drawings = await sql`
        select
          id,
          title,
          folder,
          tags,
          is_starred,
          deleted_at,
          created_at,
          updated_at
        from drawings
        where owner_id = ${ownerId}
          and (
            (${showTrash} and deleted_at is not null)
            or (not ${showTrash} and deleted_at is null)
          )
        order by updated_at desc
      `;

      return res.status(200).json({ drawings });
    }

    if (req.method === "POST") {
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

      const [drawing] = await sql`
        insert into drawings (
          owner_id,
          title,
          elements,
          app_state,
          files,
          folder,
          tags,
          is_starred
        )
        values (
          ${ownerId},
          ${title},
          ${JSON.stringify(elements)}::jsonb,
          ${JSON.stringify(appState)}::jsonb,
          ${JSON.stringify(files)}::jsonb,
          ${folder},
          ${tags}::text[],
          ${isStarred}
        )
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

      return res.status(201).json({ drawing });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
