const { sql, ensureSchema } = require('../db');
const { requireAuth, isSameOrigin } = require('../auth');

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return v ? v : null;
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      const rows = await sql`
        SELECT id, item_name, quantity, reorder_threshold, unit_cost, supplier, last_ordered_date, notes, created_at
        FROM supplies
        ORDER BY item_name ASC
        LIMIT 1000
      `;
      res.status(200).json({ supplies: rows });
    } catch (err) {
      console.error('Failed to fetch supplies:', err);
      res.status(500).json({ error: 'Failed to fetch supplies' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body || {};
    const { itemName, quantity, reorderThreshold, unitCost, supplier, lastOrderedDate, notes } = body;

    if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
      res.status(400).json({ error: 'Item name is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        INSERT INTO supplies (item_name, quantity, reorder_threshold, unit_cost, supplier, last_ordered_date, notes)
        VALUES (
          ${itemName.trim()}, ${toNumberOrNull(quantity) ?? 0}, ${toNumberOrNull(reorderThreshold)},
          ${toNumberOrNull(unitCost)}, ${supplier || null}, ${toDateOrNull(lastOrderedDate)}, ${notes || null}
        )
        RETURNING id, item_name, quantity, reorder_threshold, unit_cost, supplier, last_ordered_date, notes, created_at
      `;
      res.status(201).json({ ok: true, supply: rows[0] });
    } catch (err) {
      console.error('Failed to create supply:', err);
      res.status(500).json({ error: 'Failed to create supply' });
    }
    return;
  }

  if (req.method === 'PUT') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid supply id' });
      return;
    }

    const body = req.body || {};
    const { itemName, quantity, reorderThreshold, unitCost, supplier, lastOrderedDate, notes } = body;

    if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
      res.status(400).json({ error: 'Item name is required' });
      return;
    }

    try {
      await ensureSchema();
      const rows = await sql`
        UPDATE supplies SET
          item_name = ${itemName.trim()},
          quantity = ${toNumberOrNull(quantity) ?? 0},
          reorder_threshold = ${toNumberOrNull(reorderThreshold)},
          unit_cost = ${toNumberOrNull(unitCost)},
          supplier = ${supplier || null},
          last_ordered_date = ${toDateOrNull(lastOrderedDate)},
          notes = ${notes || null}
        WHERE id = ${id}
        RETURNING id, item_name, quantity, reorder_threshold, unit_cost, supplier, last_ordered_date, notes, created_at
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Supply not found' });
        return;
      }
      res.status(200).json({ ok: true, supply: rows[0] });
    } catch (err) {
      console.error('Failed to update supply:', err);
      res.status(500).json({ error: 'Failed to update supply' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    if (!isSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid supply id' });
      return;
    }

    try {
      await ensureSchema();
      const deleted = await sql`DELETE FROM supplies WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) {
        res.status(404).json({ error: 'Supply not found' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('Failed to delete supply:', err);
      res.status(500).json({ error: 'Failed to delete supply' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
