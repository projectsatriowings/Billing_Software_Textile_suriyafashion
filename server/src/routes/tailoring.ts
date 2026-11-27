import { requirePerm } from '../auth.ts';
import { bad, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';

export function formatMeasurement(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    customerId: r.customerId ?? r.customer_id ?? null,
    customerName: r.customerName ?? r.customer_name,
    customerPhone: r.customerPhone ?? r.customer_phone ?? null,
    chest: r.chest != null ? Number(r.chest) : null,
    waist: r.waist != null ? Number(r.waist) : null,
    shoulder: r.shoulder != null ? Number(r.shoulder) : null,
    sleeve: r.sleeve != null ? Number(r.sleeve) : null,
    length: r.length != null ? Number(r.length) : null,
    neck: r.neck != null ? Number(r.neck) : null,
    hip: r.hip != null ? Number(r.hip) : null,
    notes: r.notes ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function formatTailoringOrder(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    branchId: r.branchId ?? r.branch_id ?? null,
    orderNumber: r.orderNumber ?? r.order_number,
    customerId: r.customerId ?? r.customer_id ?? null,
    customerName: r.customerName ?? r.customer_name,
    customerPhone: r.customerPhone ?? r.customer_phone ?? null,
    measurementId: r.measurementId ?? r.measurement_id ?? null,
    serviceType: r.serviceType ?? r.service_type ?? 'stitching',
    description: r.description ?? null,
    dueDate: r.dueDate ?? r.due_date,
    status: r.status ?? 'pending',
    totalMinor: Number(r.totalMinor ?? r.total_minor ?? 0),
    advancePaidMinor: Number(r.advancePaidMinor ?? r.advance_paid_minor ?? 0),
    balanceMinor: Number(r.balanceMinor ?? r.balance_minor ?? 0),
    notes: r.notes ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function formatJobWork(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    branchId: r.branchId ?? r.branch_id ?? null,
    jobNumber: r.jobNumber ?? r.job_number,
    workerName: r.workerName ?? r.worker_name,
    workerPhone: r.workerPhone ?? r.worker_phone ?? null,
    kind: r.kind ?? 'tailoring',
    issueDate: r.issueDate ?? r.issue_date,
    dueDate: r.dueDate ?? r.due_date ?? null,
    status: r.status ?? 'issued',
    fabricIssuedMeters: r.fabricIssuedMeters != null ? Number(r.fabricIssuedMeters) : (r.fabric_issued_meters != null ? Number(r.fabric_issued_meters) : 0),
    wastagePct: r.wastagePct != null ? Number(r.wastagePct) : (r.wastage_pct != null ? Number(r.wastage_pct) : 0),
    piecesExpected: Number(r.piecesExpected ?? r.pieces_expected ?? 0),
    piecesReceived: Number(r.piecesReceived ?? r.pieces_received ?? 0),
    costPerPieceMinor: Number(r.costPerPieceMinor ?? r.cost_per_piece_minor ?? 0),
    totalCostMinor: Number(r.totalCostMinor ?? r.total_cost_minor ?? 0),
    notes: r.notes ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function registerTailoring(r: Router) {
  // ------------------------------------------------------------------------
  // Customer Measurements
  // ------------------------------------------------------------------------
  r.get('/api/measurements', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const q = (ctx.query.q ?? '').trim().toLowerCase();

    let sql = 'SELECT * FROM measurements WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (q) {
      sql += ' AND (lower(customer_name) LIKE ? OR customer_phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY updated_at DESC LIMIT 50';
    const rows = await ctx.db.query(sql, params);
    return { measurements: rows.map(formatMeasurement) };
  });

  r.post('/api/measurements', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const customerName = V.str(b.customerName, 'Customer Name', { required: true, max: 120 });
    const customerPhone = V.optStr(b.customerPhone, 'Customer Phone', 30);
    const customerId = V.optStr(b.customerId, 'Customer ID', 60);

    const chest = b.chest != null ? Number(b.chest) : null;
    const waist = b.waist != null ? Number(b.waist) : null;
    const shoulder = b.shoulder != null ? Number(b.shoulder) : null;
    const sleeve = b.sleeve != null ? Number(b.sleeve) : null;
    const length = b.length != null ? Number(b.length) : null;
    const neck = b.neck != null ? Number(b.neck) : null;
    const hip = b.hip != null ? Number(b.hip) : null;
    const notes = V.optStr(b.notes, 'Notes', 500);

    let id = V.optStr(b.id, 'ID', 60);
    if (id) {
      const cur = await ctx.db.one('SELECT id FROM measurements WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (cur) {
        await ctx.db.exec(
          `UPDATE measurements SET
            customer_name = ?, customer_phone = ?, customer_id = ?,
            chest = ?, waist = ?, shoulder = ?, sleeve = ?, length = ?, neck = ?, hip = ?, notes = ?,
            updated_at = now()
           WHERE id = ? AND tenant_id = ?`,
          [customerName, customerPhone, customerId, chest, waist, shoulder, sleeve, length, neck, hip, notes, id, tenantId],
        );
        const updated = await ctx.db.one('SELECT * FROM measurements WHERE id = ?', [id]);
        return { measurement: formatMeasurement(updated) };
      }
    }

    // Check if profile exists for this phone
    if (customerPhone) {
      const existing = await ctx.db.one('SELECT id FROM measurements WHERE tenant_id = ? AND customer_phone = ?', [tenantId, customerPhone]);
      if (existing) {
        await ctx.db.exec(
          `UPDATE measurements SET
            customer_name = ?, customer_id = ?,
            chest = ?, waist = ?, shoulder = ?, sleeve = ?, length = ?, neck = ?, hip = ?, notes = ?,
            updated_at = now()
           WHERE id = ? AND tenant_id = ?`,
          [customerName, customerId, chest, waist, shoulder, sleeve, length, neck, hip, notes, existing.id, tenantId],
        );
        const updated = await ctx.db.one('SELECT * FROM measurements WHERE id = ?', [existing.id]);
        return { measurement: formatMeasurement(updated) };
      }
    }

    id = newId('meas');
    await ctx.db.exec(
      `INSERT INTO measurements (
        id, tenant_id, customer_id, customer_name, customer_phone,
        chest, waist, shoulder, sleeve, length, neck, hip, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, customerId, customerName, customerPhone, chest, waist, shoulder, sleeve, length, neck, hip, notes],
    );

    const inserted = await ctx.db.one('SELECT * FROM measurements WHERE id = ?', [id]);
    return { measurement: formatMeasurement(inserted) };
  });

  // ------------------------------------------------------------------------
  // Tailoring Orders (Advance + Due Date)
  // ------------------------------------------------------------------------
  r.get('/api/tailoring-orders', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const status = (ctx.query.status ?? '').trim();
    const q = (ctx.query.q ?? '').trim().toLowerCase();

    let sql = 'SELECT * FROM tailoring_orders WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (q) {
      sql += ' AND (lower(order_number) LIKE ? OR lower(customer_name) LIKE ? OR customer_phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY due_date ASC, created_at DESC LIMIT 100';
    const rows = await ctx.db.query(sql, params);
    return { orders: rows.map(formatTailoringOrder) };
  });

  r.post('/api/tailoring-orders', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const customerName = V.str(b.customerName, 'Customer Name', { required: true, max: 120 });
    const customerPhone = V.optStr(b.customerPhone, 'Customer Phone', 30);
    const customerId = V.optStr(b.customerId, 'Customer ID', 60);
    const measurementId = V.optStr(b.measurementId, 'Measurement ID', 60);
    const serviceType = V.optStr(b.serviceType, 'Service Type', 50) || 'stitching';
    const description = V.optStr(b.description, 'Description', 500);
    const dueDate = V.str(b.dueDate, 'Due Date', { required: true, min: 10, max: 20 });
    const totalMinor = V.int(b.totalMinor ?? 0, 'Total Charge', { min: 0 });
    const advancePaidMinor = V.int(b.advancePaidMinor ?? 0, 'Advance Paid', { min: 0 });
    const balanceMinor = Math.max(0, totalMinor - advancePaidMinor);
    const notes = V.optStr(b.notes, 'Notes', 500);
    const branchId = ctx.user!.assignedLocation || 'MAIN';

    // Generate unique order number TL-YYYYMMDD-XXXX
    const countRow = await ctx.db.one<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM tailoring_orders WHERE tenant_id = ?',
      [tenantId],
    );
    const nextSeq = (Number(countRow?.count || 0) + 1).toString().padStart(4, '0');
    const orderNumber = `TL-${nextSeq}`;

    const id = newId('tlo');
    await ctx.db.exec(
      `INSERT INTO tailoring_orders (
        id, tenant_id, branch_id, order_number, customer_id, customer_name, customer_phone,
        measurement_id, service_type, description, due_date, status, total_minor,
        advance_paid_minor, balance_minor, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        id, tenantId, branchId, orderNumber, customerId, customerName, customerPhone,
        measurementId, serviceType, description, dueDate, totalMinor, advancePaidMinor,
        balanceMinor, notes,
      ],
    );

    const inserted = await ctx.db.one('SELECT * FROM tailoring_orders WHERE id = ?', [id]);
    await audit(ctx.db, ctx, { action: 'tailoring.order.create', entity: 'tailoring_order', entityId: id, detail: { orderNumber, totalMinor, advancePaidMinor } });

    return { order: formatTailoringOrder(inserted) };
  });

  r.patch('/api/tailoring-orders/:id', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const b = ctx.body ?? {};

    const cur = await ctx.db.one('SELECT * FROM tailoring_orders WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (!cur) throw notFound('Tailoring Order');

    const status = b.status ? V.oneOf(b.status, 'Status', ['pending', 'in_progress', 'ready', 'delivered', 'cancelled'] as const) : cur.status;
    const notes = V.optStr(b.notes, 'Notes', 500) ?? cur.notes;
    const dueDate = V.optStr(b.dueDate, 'Due Date', 20) ?? cur.due_date;
    const advancePaidMinor = b.advancePaidMinor !== undefined ? V.int(b.advancePaidMinor, 'Advance Paid', { min: 0 }) : Number(cur.advance_paid_minor);
    const totalMinor = b.totalMinor !== undefined ? V.int(b.totalMinor, 'Total Minor', { min: 0 }) : Number(cur.total_minor);
    const balanceMinor = Math.max(0, totalMinor - advancePaidMinor);

    await ctx.db.exec(
      `UPDATE tailoring_orders SET
        status = ?, notes = ?, due_date = ?, advance_paid_minor = ?, total_minor = ?, balance_minor = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ?`,
      [status, notes, dueDate, advancePaidMinor, totalMinor, balanceMinor, id, tenantId],
    );

    const updated = await ctx.db.one('SELECT * FROM tailoring_orders WHERE id = ?', [id]);
    return { order: formatTailoringOrder(updated) };
  });

  // ------------------------------------------------------------------------
  // Job Works (Fabric Issue / Worker Receipt)
  // ------------------------------------------------------------------------
  r.get('/api/job-works', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const status = (ctx.query.status ?? '').trim();

    let sql = 'SELECT * FROM job_works WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';

    const rows = await ctx.db.query(sql, params);
    return { jobWorks: rows.map(formatJobWork) };
  });

  r.post('/api/job-works', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const workerName = V.str(b.workerName, 'Worker Name', { required: true, max: 120 });
    const workerPhone = V.optStr(b.workerPhone, 'Worker Phone', 30);
    const kind = V.optStr(b.kind, 'Kind', 50) || 'tailoring';
    const issueDate = V.str(b.issueDate || new Date().toISOString().slice(0, 10), 'Issue Date', { required: true, min: 10, max: 20 });
    const dueDate = V.optStr(b.dueDate, 'Due Date', 20);
    const fabricIssuedMeters = b.fabricIssuedMeters != null ? Number(b.fabricIssuedMeters) : 0;
    const wastagePct = b.wastagePct != null ? Number(b.wastagePct) : 0;
    const piecesExpected = V.int(b.piecesExpected ?? 0, 'Pieces Expected', { min: 0 });
    const costPerPieceMinor = V.int(b.costPerPieceMinor ?? 0, 'Cost Per Piece', { min: 0 });
    const totalCostMinor = piecesExpected * costPerPieceMinor;
    const notes = V.optStr(b.notes, 'Notes', 500);
    const branchId = ctx.user!.assignedLocation || 'MAIN';

    const countRow = await ctx.db.one<{ count: string }>('SELECT COUNT(*)::text AS count FROM job_works WHERE tenant_id = ?', [tenantId]);
    const jobNumber = `JW-${(Number(countRow?.count || 0) + 1).toString().padStart(4, '0')}`;

    const id = newId('jw');
    await ctx.db.exec(
      `INSERT INTO job_works (
        id, tenant_id, branch_id, job_number, worker_name, worker_phone, kind,
        issue_date, due_date, status, fabric_issued_meters, wastage_pct,
        pieces_expected, pieces_received, cost_per_piece_minor, total_cost_minor, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, 0, ?, ?, ?)`,
      [
        id, tenantId, branchId, jobNumber, workerName, workerPhone, kind,
        issueDate, dueDate, fabricIssuedMeters, wastagePct, piecesExpected,
        costPerPieceMinor, totalCostMinor, notes,
      ],
    );

    const inserted = await ctx.db.one('SELECT * FROM job_works WHERE id = ?', [id]);
    return { jobWork: formatJobWork(inserted) };
  });

  r.patch('/api/job-works/:id', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const b = ctx.body ?? {};

    const cur = await ctx.db.one('SELECT * FROM job_works WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (!cur) throw notFound('Job Work');

    const status = b.status ? V.oneOf(b.status, 'Status', ['issued', 'in_progress', 'completed', 'cancelled'] as const) : cur.status;
    const piecesReceived = b.piecesReceived !== undefined ? V.int(b.piecesReceived, 'Pieces Received', { min: 0 }) : Number(cur.pieces_received);
    const notes = V.optStr(b.notes, 'Notes', 500) ?? cur.notes;

    await ctx.db.exec(
      `UPDATE job_works SET status = ?, pieces_received = ?, notes = ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [status, piecesReceived, notes, id, tenantId],
    );

    const updated = await ctx.db.one('SELECT * FROM job_works WHERE id = ?', [id]);
    return { jobWork: formatJobWork(updated) };
  });
}
