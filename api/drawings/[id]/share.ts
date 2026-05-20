import {
  ensureDrawingsSchema,
  requirePermission,
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
      const shares = await sql`
        select id, drawing_id, owner_id, permission, created_at, updated_at
        from drawing_shares
        where drawing_id = ${drawingId}::uuid and owner_id = ${ownerId}
        order by created_at desc
      `;

      return res.status(200).json({ shares });
    }

    if (req.method === "POST") {
      const permission = requirePermission(req.body?.permission);

      const [share] = await sql`
        insert into drawing_shares (drawing_id, owner_id, permission)
        values (${drawingId}::uuid, ${ownerId}, ${permission})
        returning id, drawing_id, owner_id, permission, created_at, updated_at
      `;

      return res.status(201).json({ share });
    }

    if (req.method === "DELETE") {
      const shareId = requireUuid(
        req.body?.shareId ?? req.query?.shareId,
        "shareId",
      );
      const [share] = await sql`
        delete from drawing_shares
        where
          id = ${shareId}::uuid
          and drawing_id = ${drawingId}::uuid
          and owner_id = ${ownerId}
        returning id
      `;

      if (!share) {
        return res.status(404).json({ error: "Share not found" });
      }

      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
