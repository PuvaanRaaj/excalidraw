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
    await ensureDrawingsSchema();

    if (req.method === "GET") {
      const drawings = await sql`
        select id, title, created_at, updated_at
        from drawings
        where owner_id = ${ownerId}
        order by updated_at desc
      `;

      return res.status(200).json({ drawings });
    }

    if (req.method === "POST") {
      const title = requireString(req.body?.title, "Untitled");
      const elements = requireJsonObject(req.body?.elements, []);
      const appState = requireJsonObject(req.body?.appState, {});
      const files = requireJsonObject(req.body?.files, {});

      const [drawing] = await sql`
        insert into drawings (owner_id, title, elements, app_state, files)
        values (
          ${ownerId},
          ${title},
          ${JSON.stringify(elements)}::jsonb,
          ${JSON.stringify(appState)}::jsonb,
          ${JSON.stringify(files)}::jsonb
        )
        returning id, title, elements, app_state, files, created_at, updated_at
      `;

      return res.status(201).json({ drawing });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
