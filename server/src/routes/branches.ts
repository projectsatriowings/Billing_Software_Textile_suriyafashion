import { requirePerm, requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, conflict, notFound, HttpError, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j, type Queryable } from '../db/index.ts';
import type { Branch, BranchInput } from '../../../shared/types.ts';
import { getOwnerEmailForTenant, enqueueDeletionAlertEmail } from '../services/mailer.ts';

const parseCounters = (v: any): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [v];
    } catch {
      return [v];
    }
  }
  return ['COUNTER-1'];
};

export const branchView = (b: any): Branch => {
  let countersList: string[] = [];
  if (Array.isArray(b.dynamic_counters) && b.dynamic_counters.length > 0) {
    countersList = b.dynamic_counters.map(String);
  } else if (Array.isArray(b.dynamicCounters) && b.dynamicCounters.length > 0) {
    countersList = b.dynamicCounters.map(String);
  } else {
    countersList = parseCounters(b.counters);
  }

  const rawDetails = b.dynamic_counter_details || b.dynamicCounterDetails || b.counterDetails;
  const counterDetails = Array.isArray(rawDetails) && rawDetails.length > 0
    ? rawDetails
    : countersList.map((code: string) => {
        const m = code.trim().match(/^counter[_\-\s]*(\d+)$/i);
        const mCode = code.trim().match(/^[A-Z0-9]+[_\-]C(?:0*)(\d+)$/i);
        const name = m ? `Counter ${m[1]}` : mCode ? `Counter ${mCode[1]}` : (code.toUpperCase().includes('EXP') ? 'Express Counter' : code);
        return {
          id: code,
          name,
          code,
          status: 'ACTIVE',
        };
      });

  return {
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address || null,
    phone: b.phone || null,
    active: Boolean(b.active ?? true),
    counters: countersList,
    counterDetails,
    managerId: b.managerId ?? b.manager_id ?? null,
    managerName: b.managerName ?? b.manager_name ?? null,
    managerEmail: b.managerEmail ?? b.manager_email ?? null,
    managerUsername: b.managerUsername ?? b.manager_username ?? null,
    countersTotal: Number(b.countersTotal ?? b.counters_total ?? countersList.length),
    countersActive: Number(b.countersActive ?? b.counters_active ?? (b.active ? countersList.length : 0)),
    createdAt: b.createdAt ?? b.created_at,
    updatedAt: b.updatedAt ?? b.updated_at,
  };
};

/**
 * Ensures dedicated Super Admin and Store Manager counters exist for the tenant.
 * - Single tenant-wide Super Admin POS Counter: ADMIN-POS ('Admin Counter') linked to MAIN branch.
 * - Dedicated Store Manager Counter per branch: ${branch.code}-MGR ('Manager Counter (${branch.code})').
 */
export async function ensureDedicatedCounters(db: Queryable, tenantId: string): Promise<void> {
  try {
    // Ensure strictly ONE dedicated Super Admin POS Counter per tenant (linked to MAIN branch or first branch)
    const mainBranch =
      (await db.one<any>("SELECT id FROM branches WHERE tenant_id = ? AND code = 'MAIN' LIMIT 1", [tenantId])) ||
      (await db.one<any>('SELECT id FROM branches WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1', [tenantId]));

    if (mainBranch) {
      // Remove any misplaced ADMIN-POS on non-main branches if any
      await db.exec(
        "DELETE FROM counters WHERE tenant_id = ? AND upper(code) = 'ADMIN-POS' AND branch_id != ?",
        [tenantId, mainBranch.id],
      );

      await db.exec(
        `INSERT INTO counters (id, tenant_id, branch_id, name, code, status, created_at, updated_at)
         VALUES ('cnt_' || substr(md5(? || '_admin'), 1, 16), ?, ?, 'Admin Counter', 'ADMIN-POS', 'ACTIVE', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [mainBranch.id, tenantId, mainBranch.id],
      );
    }

    // 3. Keep branches.counters JSON column in sync
    await db.exec(
      `UPDATE branches b
       SET counters = (
         SELECT json_agg(c.code ORDER BY c.code ASC)
         FROM counters c
         WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE'
       )
       WHERE b.tenant_id = ?
         AND EXISTS (
           SELECT 1 FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id
         )`,
      [tenantId],
    );
  } catch (err) {
    console.error('ensureDedicatedCounters error:', err);
  }
}

export function registerBranches(r: Router) {
  // 1. Get branches accessible to the user
  r.get('/api/branches', requireUser, async (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;

    // Auto-ensure dedicated Admin & Manager counters exist
    await ensureDedicatedCounters(ctx.db, tenantId);

    const isSuperAdmin = role === 'owner' || String(role).toUpperCase() === 'SUPER_ADMIN';

    // Super Admin / Owner: All company branches
    // Other roles: ONLY [their own branch]
    let whereClause = 'WHERE b.tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (!isSuperAdmin) {
      if (ctx.query.for === 'transfer_destinations') {
        // Active destination branches for stock transfers
        whereClause += ' AND b.active = TRUE';
      } else {
        const userBranchId = ctx.user!.branchId;
        if (!userBranchId) {
          throw bad("Your account isn't linked to a branch. Contact your admin.", 'NO_BRANCH');
        }
        whereClause += ' AND (b.id = ? OR b.code = ?)';
        params.push(userBranchId, userBranchId);
      }
    }

    const cashierFilter = role === 'cashier' ? " AND c.code != 'ADMIN-POS' AND c.code NOT LIKE '%-MGR'" : "";

    const rows = await ctx.db.query<any>(
      `SELECT b.*, u.name AS manager_name, u.email AS manager_email, u.username AS manager_username,
      (SELECT count(*):: int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id ${cashierFilter}) AS counters_total,
      (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS counters_active,
      (SELECT json_agg(c.code ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS dynamic_counters,
      (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code, 'status', c.status) ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS dynamic_counter_details
       FROM branches b
       LEFT JOIN users u ON (u.branch_id = b.id OR u.id = b.manager_id) AND lower(u.role) IN ('manager', 'store_manager') AND u.deleted_at IS NULL
       ${ whereClause }
       ORDER BY b.code = 'MAIN' DESC, b.code ASC`,
      params,
    );

    // If branches table is empty for this tenant (e.g. freshly registered), sync from tenant locations
    if (rows.length === 0 && role === 'owner') {
      const tenant = await ctx.db.one<any>('SELECT locations, name, address, phone FROM tenants WHERE id = ?', [tenantId]);
      const locations: string[] = Array.isArray(tenant?.locations)
        ? tenant.locations
        : (typeof tenant?.locations === 'string' ? JSON.parse(tenant.locations) : ['MAIN']);

      for (const loc of locations) {
        const branchId = newId('br');
        const code = loc.trim().toUpperCase();
        await ctx.db.exec(
          `INSERT INTO branches(id, tenant_id, code, name, address, phone, active, counters)
  VALUES(?, ?, ?, ?, ?, ?, TRUE, '["COUNTER-1"]')
           ON CONFLICT(tenant_id, code) DO NOTHING`,
          [branchId, tenantId, code, `${ tenant?.name || 'Main' } (${ code })`, tenant?.address || null, tenant?.phone || null],
        );
      }

      const syncedRows = await ctx.db.query<any>(
    `SELECT b.*, u.name AS manager_name, u.email AS manager_email, u.username AS manager_username,
              (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id ${cashierFilter}) AS counters_total,
              (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS counters_active,
              (SELECT json_agg(c.code ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS dynamic_counters,
              (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code, 'status', c.status) ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE' ${cashierFilter}) AS dynamic_counter_details
         FROM branches b
         LEFT JOIN users u ON (u.branch_id = b.id OR u.id = b.manager_id) AND lower(u.role) IN ('manager', 'store_manager') AND u.deleted_at IS NULL
         WHERE b.tenant_id = ?
         ORDER BY b.code = 'MAIN' DESC, b.code ASC`,
    [tenantId],
      );
  return { branches: syncedRows.map(branchView) };
}

return { branches: rows.map(branchView) };
  });

// 2. Create a new branch (Super Admin only)
r.post('/api/branches', requirePerm('settings'), async (ctx) => {
  const b = ctx.body ?? {};
  const tenantId = ctx.user!.tenantId;

  const rawCode = V.str(b.code, 'Branch Code', { required: true, max: 20 });
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
  if (!code) throw bad('Branch code must contain alphanumeric characters (e.g. BR-NORTH, T-NAGAR)', 'VALIDATION');

  const name = V.str(b.name, 'Branch Name', { required: true, max: 100 });
  const address = V.optStr(b.address, 'Address', 300);
  const phone = V.optStr(b.phone, 'Phone', 30);
  const active = b.active !== undefined ? V.bool(b.active) : true;
  const managerId = V.optStr(b.managerId, 'Store Manager ID', 50);

  const countersList: string[] = Array.isArray(b.counters) && b.counters.length > 0
    ? Array.from(new Set(b.counters.map((c: any) => V.str(c, 'Counter', { required: true, max: 30 }).trim().toUpperCase())))
    : ['COUNTER-1'];

  // Check duplicate branch code within tenant
  const existing = await ctx.db.one('SELECT id FROM branches WHERE tenant_id = ? AND code = ?', [tenantId, code]);
  if (existing) throw conflict(`Branch with code "${code}" already exists in this company.`, 'DUPLICATE_BRANCH');

  // Verify manager exists in this tenant if provided
  if (managerId) {
    const mgr = await ctx.db.one('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?', [managerId, tenantId]);
    if (!mgr) throw notFound('Store Manager');
    if (mgr.role !== 'manager' && mgr.role !== 'owner') {
      throw bad('Selected user must have Store Manager or Owner role.', 'INVALID_ROLE');
    }
  }

  const branchId = newId('br');
  await ctx.db.tx(async (q) => {
    await q.exec(
      `INSERT INTO branches (id, tenant_id, code, name, address, phone, active, counters, manager_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
      [branchId, tenantId, code, name, address, phone, active, j(countersList), managerId || null],
    );

    // Keep tenants.locations in sync
    const t = await q.one<any>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
    const curLocs: string[] = Array.isArray(t?.locations)
      ? t.locations
      : (typeof t?.locations === 'string' ? JSON.parse(t.locations) : ['MAIN']);
    if (!curLocs.includes(code)) {
      curLocs.push(code);
      await q.exec('UPDATE tenants SET locations = ?::jsonb WHERE id = ?', [j(curLocs), tenantId]);
    }

    // If manager assigned, sync users.branch_id and add branch to manager's allowed_locations
    if (managerId) {
      await q.exec('UPDATE users SET branch_id = ?, updated_at = now() WHERE id = ?', [branchId, managerId]);
      const mgrUser = await q.one<any>('SELECT allowed_locations FROM users WHERE id = ?', [managerId]);
      const mgrAllowed: string[] = Array.isArray(mgrUser?.allowedLocations || mgrUser?.allowed_locations)
        ? (mgrUser.allowedLocations || mgrUser.allowed_locations)
        : ['MAIN'];
      if (!mgrAllowed.includes(code)) {
        mgrAllowed.push(code);
        await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(mgrAllowed), managerId]);
      }
    }

    await audit(q, ctx, {
      action: 'branch.create',
      entity: 'branch',
      entityId: branchId,
      detail: { code, name, counters: countersList, managerId },
    });
  });

  // Automatically provision dedicated manager counter for this branch (and admin counter if MAIN)
  await ensureDedicatedCounters(ctx.db, tenantId);

  const row = await ctx.db.one<any>(
      `SELECT b.*, u.name AS manager_name, u.email AS manager_email, u.username AS manager_username,
      (SELECT count(*):: int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id) AS counters_total,
      (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS counters_active,
      (SELECT json_agg(c.code ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS dynamic_counters,
      (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code, 'status', c.status) ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS dynamic_counter_details
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.id = ? `,
      [branchId],
    );
    return branchView(row);
  });

  // 3. Update branch (Super Admin or Store Manager updating assigned branch counters)
  r.patch('/api/branches/:id', requirePerm('branches'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.params.id;
    const isOwner = ctx.user!.role === 'owner';

    return ctx.db.tx(async (q) => {
      const cur = await q.one<any>('SELECT * FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
      if (!cur) throw notFound('Branch');

      // If store manager, verify this branch is in their allowed locations
      if (!isOwner) {
        const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
        if (!allowed.has(cur.code)) {
          throw bad('You can only manage counters for your authorized branches.', 'FORBIDDEN');
        }
      }

      // Owner can update code
      let code = cur.code;
      if (isOwner && b.code !== undefined) {
        const rawCode = V.str(b.code, 'Branch Code', { required: true, max: 20 });
        const sanitizedCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
        if (!sanitizedCode) {
          throw bad('Branch code must contain alphanumeric characters (e.g. BR-NORTH, T-NAGAR)', 'VALIDATION');
        }
        if (sanitizedCode !== cur.code) {
          const dup = await q.one('SELECT id FROM branches WHERE tenant_id = ? AND code = ? AND id != ?', [tenantId, sanitizedCode, branchId]);
          if (dup) {
            throw conflict(`Branch with code "${sanitizedCode}" already exists in this company.`, 'DUPLICATE_BRANCH');
          }
          code = sanitizedCode;
        }
      }

      const name = isOwner && b.name !== undefined ? V.str(b.name, 'Branch Name', { required: true, max: 100 }) : cur.name;
      const address = isOwner && b.address !== undefined ? V.optStr(b.address, 'Address', 300) : cur.address;
      const phone = isOwner && b.phone !== undefined ? V.optStr(b.phone, 'Phone', 30) : cur.phone;
      const active = isOwner && b.active !== undefined ? V.bool(b.active) : cur.active;

      let counters = parseCounters(cur.counters);
      if (b.counters !== undefined) {
        if (!Array.isArray(b.counters) || b.counters.length === 0) {
          throw bad('A branch must have at least one counter.', 'VALIDATION');
        }
        counters = Array.from(new Set(b.counters.map((c: any) => V.str(c, 'Counter', { required: true, max: 30 }).trim().toUpperCase())));
        if (counters.length === 0) {
          throw bad('A branch must have at least one counter.', 'VALIDATION');
        }
      }

      const curManagerId = cur.managerId ?? cur.manager_id ?? null;
      let managerId = curManagerId;
      if (isOwner && b.managerId !== undefined) {
        managerId = V.optStr(b.managerId, 'Store Manager ID', 50) || null;
        if (managerId) {
          const mgr = await q.one('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?', [managerId, tenantId]);
          if (!mgr) throw notFound('Store Manager');
          if (mgr.role !== 'manager' && mgr.role !== 'owner') {
            throw bad('Selected user must have Store Manager or Owner role.', 'INVALID_ROLE');
          }
        }
      }

      // If branch code changed, cascade update location in all related records
      if (code !== cur.code) {
        // Sync tenants.locations
        const t = await q.one<any>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
        const curLocs: string[] = Array.isArray(t?.locations)
          ? t.locations
          : (typeof t?.locations === 'string' ? JSON.parse(t.locations) : ['MAIN']);
        const updatedLocs = curLocs.map((loc: string) => (loc === cur.code ? code : loc));
        if (!updatedLocs.includes(code)) {
          updatedLocs.push(code);
        }
        await q.exec('UPDATE tenants SET locations = ?::jsonb WHERE id = ?', [j(updatedLocs), tenantId]);

        // Sync users assigned_location
        await q.exec('UPDATE users SET assigned_location = ? WHERE tenant_id = ? AND assigned_location = ?', [code, tenantId, cur.code]);

        // Sync users allowed_locations
        const tenantUsers = await q.query<any>('SELECT id, allowed_locations FROM users WHERE tenant_id = ?', [tenantId]);
        for (const u of tenantUsers) {
          const userAllowed: string[] = Array.isArray(u.allowed_locations)
            ? u.allowed_locations
            : (typeof u.allowed_locations === 'string' ? JSON.parse(u.allowed_locations) : []);
          if (userAllowed.includes(cur.code)) {
            const newAllowed = userAllowed.map((l: string) => (l === cur.code ? code : l));
            await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(newAllowed), u.id]);
          }
        }

        // Preserve and re-link transaction and movement records
        await q.exec('UPDATE invoices SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE payments SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE shifts SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE expenses SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE stock_moves SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE stock_counts SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
      }

      await q.exec(
        `UPDATE branches 
         SET code = ?, name = ?, address = ?, phone = ?, active = ?, counters = ?::jsonb, manager_id = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [code, name, address, phone, active, j(counters), managerId || null, branchId, tenantId],
      );

      // Keep users.branch_id in sync
      if (managerId !== curManagerId) {
        if (curManagerId) {
          await q.exec('UPDATE users SET branch_id = NULL WHERE id = ?', [curManagerId]);
        }
        if (managerId) {
          await q.exec('UPDATE users SET branch_id = ?, updated_at = now() WHERE id = ?', [branchId, managerId]);
        }
      }

      // If new manager assigned, ensure allowed_locations includes branch code
      if (managerId && managerId !== curManagerId) {
        const mgrUser = await q.one<any>('SELECT allowed_locations FROM users WHERE id = ?', [managerId]);
        const mgrAllowed: string[] = Array.isArray(mgrUser?.allowedLocations || mgrUser?.allowed_locations)
          ? (mgrUser.allowedLocations || mgrUser.allowed_locations)
          : ['MAIN'];
        if (!mgrAllowed.includes(code)) {
          mgrAllowed.push(code);
          await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(mgrAllowed), managerId]);
        }
      }

      // If counters list changed, ensure active staff assigned to this branch have a valid counter
      if (b.counters !== undefined && counters.length > 0) {
        const primaryCounter = counters[0];
        const staffInBranch = await q.query<any>(
          'SELECT id, assigned_counter FROM users WHERE tenant_id = ? AND assigned_location = ?',
          [tenantId, code],
        );
        for (const st of staffInBranch) {
          if (!counters.includes(st.assigned_counter)) {
            await q.exec('UPDATE users SET assigned_counter = ? WHERE id = ?', [primaryCounter, st.id]);
          }
        }
      }

      await audit(q, ctx, {
        action: 'branch.update',
        entity: 'branch',
        entityId: branchId,
        detail: {
          before: { code: cur.code, name: cur.name, active: cur.active, counters: cur.counters, managerId: cur.manager_id },
          after: { code, name, active, counters, managerId },
        },
      });

      const updated = await q.one<any>(
  `SELECT b.*, u.name AS manager_name, u.email AS manager_email, u.username AS manager_username,
              (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id) AS counters_total,
              (SELECT count(*)::int FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS counters_active,
              (SELECT json_agg(c.code ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS dynamic_counters,
              (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code, 'status', c.status) ORDER BY c.code ASC) FROM counters c WHERE c.branch_id = b.id AND c.tenant_id = b.tenant_id AND c.status = 'ACTIVE') AS dynamic_counter_details
         FROM branches b
         LEFT JOIN users u ON u.id = b.manager_id
         WHERE b.id = ?`,
  [branchId],
      );
return branchView(updated);
    });
  });

// 4. Detailed branch metrics summary
r.get('/api/branches/:id/summary', requirePerm('branches'), async (ctx) => {
  const tenantId = ctx.user!.tenantId;
  const branchId = ctx.params.id;
  const branch = await ctx.db.one<any>('SELECT * FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
  if (!branch) throw notFound('Branch');

  // Permission check for non-super-admin: strictly scoped to assigned branch (returns 404 on others)
  const isSuperAdmin = ctx.user!.role === 'owner' || String(ctx.user!.role).toUpperCase() === 'SUPER_ADMIN';
  if (!isSuperAdmin) {
    if (branch.id !== ctx.user!.branchId && branch.code !== ctx.user!.assignedLocation) {
      throw notFound('Branch');
    }
  }

  const loc = branch.code;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Sales in this branch
  const sales = await ctx.db.one<{ count: number; total: number }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND location = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
    [tenantId, loc, todayStr],
  );

  // Collections in this branch
  const collections = await ctx.db.one<{ total: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND location = ? AND (status IS NULL OR status = 'posted')
         AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date))`,
    [tenantId, loc, todayStr, todayStr],
  );

  // Active shifts in this branch
  const activeShifts = await ctx.db.query<any>(
    `SELECT s.*, u.name AS cashier_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = ? AND s.location = ? AND s.status = 'open'
       ORDER BY s.opened_at DESC`,
    [tenantId, loc],
  );

  // Closed shifts awaiting review in this branch
  const pendingReviewShifts = await ctx.db.query<any>(
    `SELECT s.*, u.name AS cashier_name, cu.name AS closed_by_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.closed_by
       WHERE s.tenant_id = ? AND s.location = ? AND s.status = 'closed' AND s.reviewed_by IS NULL
       ORDER BY s.closed_at DESC
       LIMIT 5`,
    [tenantId, loc],
  );

  // Low stock alerts at this branch location
  const lowStock = await ctx.db.query<any>(
    `SELECT it.id, it.name, it.sku, COALESCE(SUM(sm.qty_milli), 0)::bigint AS stock, it.reorder_milli AS reorder
       FROM items it
       LEFT JOIN stock_moves sm ON sm.item_id = it.id AND sm.tenant_id = it.tenant_id AND sm.location = ?
       WHERE it.tenant_id = ? AND it.active = TRUE AND it.track_stock = TRUE
       GROUP BY it.id, it.name, it.sku, it.reorder_milli
       HAVING COALESCE(SUM(sm.qty_milli), 0) <= 20000
       LIMIT 5`,
    [loc, tenantId],
  );

  // Staff assigned to this branch
  const staff = await ctx.db.query<any>(
    `SELECT id, name, email, role, active, assigned_counter
       FROM users
       WHERE tenant_id = ? AND assigned_location = ?
       ORDER BY role, name`,
    [tenantId, loc],
  );

  return {
    branch: branchView(branch),
    todaySalesCount: Number(sales?.count ?? 0),
    todaySalesTotalMinor: Number(sales?.total ?? 0),
    todayCollectionsMinor: Number(collections?.total ?? 0),
    activeShiftsCount: activeShifts.length,
    activeShifts: activeShifts.map((s) => ({
      id: s.id,
      shiftNumber: s.shiftNumber ?? s.shift_number,
      cashierName: s.cashierName ?? s.cashier_name,
      counter: s.counter || 'COUNTER-1',
      openedAt: s.openedAt ?? s.opened_at,
      openingCashMinor: Number(s.openingCashMinor ?? s.opening_cash_minor ?? 0),
    })),
    pendingReviewShiftsCount: pendingReviewShifts.length,
    pendingReviewShifts: pendingReviewShifts.map((s) => ({
      id: s.id,
      shiftNumber: s.shiftNumber ?? s.shift_number,
      cashierName: s.cashierName ?? s.cashier_name,
      closedAt: s.closedAt ?? s.closed_at,
      varianceMinor: s.varianceMinor !== null && s.varianceMinor !== undefined
        ? Number(s.varianceMinor ?? s.variance_minor)
        : 0,
    })),
    lowStockCount: lowStock.length,
    lowStock: lowStock.map((l) => ({
      id: l.id,
      name: l.name,
      sku: l.sku,
      stockMilli: Number(l.stock ?? 0),
    })),
    staff: staff.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      counter: u.assignedCounter ?? u.assigned_counter,
    })),
  };
});

// ----------------------------------------------------------------------------
// Branch Delete Impact & Permanent Delete
// ----------------------------------------------------------------------------
// What happens to each kind of record that points at a branch when it is deleted:
//   HISTORY (kept, branch name snapshotted, link cleared): bills, payments, shifts, purchases,
//     expenses, cash movements, stock history, customers, card terminal transactions.
//   BRANCH SET-UP (deleted): counters, number series, branch barcode links, branch categories,
//     card terminals, branch promotions without usage, scheduled reports, SMS logs.
//   PRODUCTS: branch products with no history are deleted; ones with history are kept inactive.
//   PEOPLE: cashiers / counter logins are deleted, or deactivated if they have history;
//     managers and other staff are only unassigned.
//   BLOCKING (deletion refused with a clear 409): customer/supplier payment allocations and
//     promotions that were already used — these must stay tied to the branch.

/** Records that must stay attached to the branch, so they block a permanent delete. One query. */
async function findBranchDeleteBlockers(q: Queryable, tenantId: string, branchId: string) {
  const row = await q.one<any>(
    `SELECT
       (SELECT count(*) FROM credit_allocations WHERE tenant_id = ? AND branch_id = ?)::int AS credit_allocations,
       (SELECT count(*) FROM payment_allocations WHERE tenant_id = ? AND branch_id = ?)::int AS payment_allocations,
       (SELECT count(*) FROM supplier_payment_allocations WHERE tenant_id = ? AND branch_id = ?)::int AS supplier_payment_allocations,
       (SELECT count(*) FROM promotions p WHERE p.tenant_id = ? AND p.branch_id = ?
          AND EXISTS (SELECT 1 FROM promotion_usage u WHERE u.promotion_id = p.id))::int AS used_promotions`,
    [tenantId, branchId, tenantId, branchId, tenantId, branchId, tenantId, branchId],
  );
  const labels: Array<[string, string, string]> = [
    ['credit_allocations', 'creditAllocations', 'customer credit allocations'],
    ['payment_allocations', 'paymentAllocations', 'customer payment allocations'],
    ['supplier_payment_allocations', 'supplierPaymentAllocations', 'supplier payment allocations'],
    ['used_promotions', 'usedPromotions', 'promotions already used on bills'],
  ];
  return labels
    .map(([key, camel, label]) => ({ key, label, count: Number(row?.[camel] ?? row?.[key] ?? 0) }))
    .filter((b) => b.count > 0);
}

/** Foreign keys pointing at a table (the schema does not change while the server runs, so cached). */
const fkCache = new Map<string, Array<{ tbl: string; col: string; onDelete: string }>>();
async function foreignKeysTo(q: Queryable, table: string) {
  const hit = fkCache.get(table);
  if (hit) return hit;
  const rows = await q.query<any>(
    `SELECT con.conrelid::regclass::text AS tbl, att.attname AS col, con.confdeltype AS on_delete
     FROM pg_constraint con
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
     WHERE con.contype = 'f' AND con.confrelid = ?::regclass`,
    [table],
  );
  const list = rows
    .map((r: any) => ({ tbl: String(r.tbl), col: String(r.col), onDelete: String(r.onDelete ?? r.on_delete) }))
    .filter((r) => /^[a-z_][a-z0-9_]*$/.test(r.tbl) && /^[a-z_][a-z0-9_]*$/.test(r.col));
  fkCache.set(table, list);
  return list;
}

async function loadBranchForDelete(q: Queryable, tenantId: string, idOrCode: string) {
  return q.one<any>('SELECT * FROM branches WHERE (id = ? OR code = ?) AND tenant_id = ?', [idOrCode, idOrCode, tenantId]);
}

/** Users removed with the branch: its cashiers and the login accounts of its counters. */
async function loadBranchRemovableUsers(q: Queryable, tenantId: string, branchId: string, counterIds: string[]) {
  return q.query<any>(
    `SELECT id, name, role FROM users
     WHERE tenant_id = ? AND deleted_at IS NULL
       AND (
         (branch_id = ? AND role IN ('cashier', 'counter'))
         OR (role = 'counter' AND counter_id = ANY(?::text[]))
       )`,
    [tenantId, branchId, counterIds],
  );
}

async function loadBranchManager(q: Queryable, tenantId: string, branch: any) {
  const mgrId = branch.managerId ?? branch.manager_id;
  if (mgrId) {
    const m = await q.one<any>('SELECT id, name FROM users WHERE id = ? AND tenant_id = ?', [mgrId, tenantId]);
    if (m) return m;
  }
  return q.one<any>(
    "SELECT id, name FROM users WHERE tenant_id = ? AND branch_id = ? AND role = 'manager' AND deleted_at IS NULL LIMIT 1",
    [tenantId, branch.id],
  );
}

r.get('/api/branches/:id/delete-impact', requirePerm('settings'), async (ctx) => {
  const tenantId = ctx.user!.tenantId;
  const branch = await loadBranchForDelete(ctx.db, tenantId, ctx.params.id);
  if (!branch) throw notFound('Branch');

  const counters = await ctx.db.query<any>(
    'SELECT id, name, code, login_username FROM counters WHERE branch_id = ? AND tenant_id = ?',
    [branch.id, tenantId],
  );
  const counterLoginsCount = counters.filter((c) => Boolean(c.loginUsername || c.login_username)).length;
  const removable = await loadBranchRemovableUsers(ctx.db, tenantId, branch.id, counters.map((c) => c.id));
  const manager = await loadBranchManager(ctx.db, tenantId, branch);
  const blockers = await findBranchDeleteBlockers(ctx.db, tenantId, branch.id);
  const billsRow = await ctx.db.one<{ n: number }>('SELECT count(*)::int AS n FROM invoices WHERE tenant_id = ? AND branch_id = ?', [tenantId, branch.id]);

  return {
    branchName: branch.name,
    branchCode: branch.code,
    countersCount: counters.length,
    counterLoginsCount,
    cashiersCount: removable.filter((u) => u.role === 'cashier').length,
    managerName: manager ? manager.name : null,
    billsCount: Number(billsRow?.n ?? 0),
    canDelete: branch.code !== 'MAIN' && blockers.length === 0,
    blockers,
  };
});

// Permanently delete a branch in ONE transaction: either everything below happens or nothing does.
r.delete('/api/branches/:id', requirePerm('settings'), async (ctx) => {
  const tenantId = ctx.user!.tenantId;
  const branch = await loadBranchForDelete(ctx.db, tenantId, ctx.params.id);
  if (!branch) throw notFound('Branch');
  if (branch.code === 'MAIN') throw bad('Cannot delete Central Main Branch (MAIN)', 'MAIN_PROTECTED');

  // The client must send the branch code (or name) the user typed, so a stray request cannot delete.
  const typed = String(ctx.query.confirm ?? ctx.body?.confirm ?? '').trim().toUpperCase();
  const expected = [branch.code, branch.name].filter(Boolean).map((v: string) => String(v).trim().toUpperCase());
  if (!typed) throw bad(`Type the branch code ${branch.code} to confirm the deletion.`, 'CONFIRMATION_REQUIRED');
  if (!expected.includes(typed)) throw bad(`The confirmation does not match. Type ${branch.code} exactly.`, 'CONFIRMATION_MISMATCH');

  const branchId: string = branch.id;
  let stage = 'start';
  let counters: any[] = [];
  let removable: any[] = [];
  let manager: any = null;
  const summary = { usersDeleted: 0, usersDeactivated: 0, staffUnassigned: 0, productsDeleted: 0, productsKeptInactive: 0 };

  try {
    await ctx.db.tx(async (q) => {
      stage = 'check blocking records';
      const blockers = await findBranchDeleteBlockers(q, tenantId, branchId);
      if (blockers.length > 0) {
        throw conflict(
          `Branch cannot be permanently deleted because dependent records still exist: ${blockers
            .map((b) => `${b.count} ${b.label}`)
            .join(', ')}. Disable the branch instead to keep these records intact.`,
          'BRANCH_HAS_DEPENDENCIES',
          { blockers },
        );
      }

      stage = 'load counters, staff and manager';
      counters = await q.query<any>('SELECT id, name, code FROM counters WHERE branch_id = ? AND tenant_id = ?', [branchId, tenantId]);
      const counterIds: string[] = counters.map((c) => c.id);
      removable = await loadBranchRemovableUsers(q, tenantId, branchId, counterIds);
      manager = await loadBranchManager(q, tenantId, branch);
      const removableIds: string[] = removable.map((u) => u.id);

      stage = 'audit log';
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'branch',
        entityId: branchId,
        detail: {
          name: branch.name,
          code: branch.code,
          countersCount: counters.length,
          cashiersCount: removable.filter((u) => u.role === 'cashier').length,
          managerUnassigned: manager ? manager.name : null,
        },
      });

      // History keeps showing the right branch / counter / cashier names after the links are cleared.
      // One statement for bills, payments and shifts (data-modifying CTEs on different tables).
      stage = 'snapshot names on history';
      const counterName = (alias: string) => `(SELECT COALESCE(NULLIF(c.name, ''), c.code) FROM counters c
          WHERE c.tenant_id = ${alias}.tenant_id AND c.branch_id = $2
            AND (c.id = ${alias}.counter_id OR (${alias}.branch_id = $2 AND (${alias}.counter = c.code OR ${alias}.counter = c.name)))
          LIMIT 1)`;
      const userName = (expr: string) => `(SELECT u.name FROM users u WHERE u.id = ${expr} AND u.id = ANY($4::text[]))`;
      await q.exec(
        `WITH inv AS (
           UPDATE invoices i SET
             branch_name_snapshot = CASE WHEN i.branch_id = $2 THEN COALESCE(i.branch_name_snapshot, $3) ELSE i.branch_name_snapshot END,
             counter_name_snapshot = COALESCE(i.counter_name_snapshot, ${counterName('i')}),
             cashier_name_snapshot = COALESCE(i.cashier_name_snapshot, ${userName('i.created_by')})
           WHERE i.tenant_id = $1 AND (i.branch_id = $2 OR i.counter_id = ANY($5::text[]) OR i.created_by = ANY($4::text[]))
           RETURNING 1
         ), pay AS (
           UPDATE payments p SET
             branch_name_snapshot = CASE WHEN p.branch_id = $2 THEN COALESCE(p.branch_name_snapshot, $3) ELSE p.branch_name_snapshot END,
             counter_name_snapshot = COALESCE(p.counter_name_snapshot, ${counterName('p')}),
             cashier_name_snapshot = COALESCE(p.cashier_name_snapshot, ${userName('p.created_by')}, ${userName('p.received_by')})
           WHERE p.tenant_id = $1 AND (p.branch_id = $2 OR p.counter_id = ANY($5::text[]) OR p.created_by = ANY($4::text[]) OR p.received_by = ANY($4::text[]))
           RETURNING 1
         ), shf AS (
           UPDATE shifts s SET
             branch_name_snapshot = CASE WHEN s.branch_id = $2 THEN COALESCE(s.branch_name_snapshot, $3) ELSE s.branch_name_snapshot END,
             counter_name_snapshot = COALESCE(s.counter_name_snapshot, ${counterName('s')}),
             cashier_name_snapshot = COALESCE(s.cashier_name_snapshot, ${userName('s.user_id')})
           WHERE s.tenant_id = $1 AND (s.branch_id = $2 OR s.counter_id = ANY($5::text[]) OR s.user_id = ANY($4::text[]))
           RETURNING 1
         )
         SELECT (SELECT count(*) FROM inv) + (SELECT count(*) FROM pay) + (SELECT count(*) FROM shf) AS n`,
        [tenantId, branchId, branch.name, removableIds, counterIds],
      );

      // Clear the branch link on history (one statement). Stock moves also get their location
      // retagged, so they can never count as another branch's stock via the location fallback.
      stage = 'detach history from branch';
      const historyTables = [
        'invoices', 'invoice_lines', 'payments', 'shifts', 'cash_movements', 'purchases', 'purchase_lines',
        'expenses', 'stock_adjustments', 'stock_counts', 'stock_count_lines', 'terminal_transactions',
        'parties', 'wholesale_customers',
      ];
      await q.exec(
        `WITH ${historyTables
          .map((t, i) => `d${i} AS (UPDATE ${t} SET branch_id = NULL WHERE tenant_id = $1 AND branch_id = $2 RETURNING 1)`)
          .join(',\n              ')},
              dsm AS (UPDATE stock_moves SET branch_id = NULL, location = $3 WHERE tenant_id = $1 AND branch_id = $2 RETURNING 1)
         SELECT 1`,
        [tenantId, branchId, `DELETED-${branch.code}`],
      );

      // Products: no history -> deleted; with history -> kept, inactive, without a branch.
      stage = 'products of the branch';
      const itemResult = await q.one<any>(
        `WITH bi AS (
           SELECT i.id,
                  (EXISTS (SELECT 1 FROM invoice_lines x WHERE x.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM purchase_lines x WHERE x.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM stock_moves x WHERE x.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM stock_adjustments x WHERE x.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM stock_count_lines x WHERE x.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM stock_transfer_lines x WHERE x.item_id = i.id)) AS has_history
           FROM items i WHERE i.tenant_id = $1 AND i.branch_id = $2
         ), del AS (
           DELETE FROM items WHERE id IN (SELECT id FROM bi WHERE NOT has_history) RETURNING 1
         ), keep AS (
           UPDATE items SET branch_id = NULL, active = false, updated_at = now()
           WHERE id IN (SELECT id FROM bi WHERE has_history) RETURNING 1
         )
         SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM keep)::int AS kept`,
        [tenantId, branchId],
      );
      summary.productsDeleted = Number(itemResult?.deleted ?? 0);
      summary.productsKeptInactive = Number(itemResult?.kept ?? 0);

      // Branch set-up records (one statement).
      stage = 'branch set-up records';
      const setupTables = ['product_barcodes', 'number_series', 'categories', 'promotions', 'scheduled_sales_reports', 'sms_logs', 'card_terminals'];
      await q.exec(
        `WITH ${setupTables.map((t, i) => `s${i} AS (DELETE FROM ${t} WHERE tenant_id = $1 AND branch_id = $2 RETURNING 1)`).join(',\n              ')}
         SELECT 1`,
        [tenantId, branchId],
      );

      // Cashiers & counter logins: delete when nothing else points at them; otherwise deactivate and
      // free their username/email (bills, shifts, payments still point at them).
      stage = 'remove cashiers and counter logins';
      if (removableIds.length) {
        const userRefs = (await foreignKeysTo(q, 'users')).filter((r) => r.onDelete === 'a' || r.onDelete === 'r');
        const referenced = userRefs.length
          ? await q.query<any>(
            `SELECT DISTINCT ref_id FROM (
               ${userRefs.map((r) => `SELECT "${r.col}" AS ref_id FROM "${r.tbl}" WHERE "${r.col}" = ANY($1::text[])`).join('\n               UNION ALL ')}
             ) refs`,
            [removableIds],
          )
          : [];
        const keepIds: string[] = referenced.map((r: any) => r.refId ?? r.ref_id);
        const dropIds = removableIds.filter((uid) => !keepIds.includes(uid));
        if (keepIds.length) {
          await q.exec(
            `UPDATE users SET active = false, status = 'DISABLED', deleted_at = now(), branch_id = NULL, counter_id = NULL,
                    username = NULL, email = NULL, updated_at = now()
             WHERE tenant_id = ? AND id = ANY(?::text[])`,
            [tenantId, keepIds],
          );
        }
        if (dropIds.length) await q.exec('DELETE FROM users WHERE tenant_id = ? AND id = ANY(?::text[])', [tenantId, dropIds]);
        summary.usersDeactivated = keepIds.length;
        summary.usersDeleted = dropIds.length;
      }

      // Managers and any other staff are only unassigned, never deleted; then remove the counters.
      stage = 'unassign staff and delete counters';
      const staffRow = await q.one<any>(
        `WITH un AS (
           UPDATE users SET branch_id = NULL, updated_at = now()
           WHERE tenant_id = $1 AND branch_id = $2 RETURNING 1
         ), uc AS (
           UPDATE users SET counter_id = NULL WHERE tenant_id = $1 AND counter_id = ANY($3::text[]) RETURNING 1
         )
         SELECT (SELECT count(*) FROM un)::int AS unassigned`,
        [tenantId, branchId, counterIds],
      );
      summary.staffUnassigned = Number(staffRow?.unassigned ?? 0);
      await q.exec('DELETE FROM counters WHERE branch_id = ? AND tenant_id = ?', [branchId, tenantId]);

      // Safety net: anything still pointing at the branch (e.g. a table added later) blocks the delete
      // with a clear message instead of a raw database error. One query.
      stage = 'check remaining references';
      const branchRefs = await foreignKeysTo(q, 'branches');
      const remainingRows = branchRefs.length
        ? await q.query<any>(
          `SELECT tbl, n FROM (
             ${branchRefs.map((r) => `SELECT '${r.tbl}' AS tbl, count(*)::int AS n FROM "${r.tbl}" WHERE "${r.col}" = $1`).join('\n             UNION ALL ')}
           ) refs WHERE n > 0`,
          [branchId],
        )
        : [];
      const remaining = remainingRows.map((r: any) => ({ table: String(r.tbl), count: Number(r.n) }));
      if (remaining.length) {
        throw conflict(
          `Branch cannot be permanently deleted because dependent records still exist (${remaining
            .map((r) => `${r.count} in ${r.table.replace(/_/g, ' ')}`)
            .join(', ')}). Disable the branch instead.`,
          'BRANCH_HAS_DEPENDENCIES',
          { remaining },
        );
      }

      stage = 'delete branch';
      await q.exec('DELETE FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
    });
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    console.error(JSON.stringify({
      level: 'error',
      msg: 'branch delete failed (rolled back, nothing changed)',
      branchId,
      stage,
      dbCode: err?.code ?? null,
      table: err?.table ?? null,
      constraint: err?.constraint ?? null,
      error: String(err?.message ?? err),
    }));
    if (err?.code === '23503') {
      throw conflict(
        'Branch cannot be permanently deleted because dependent records still exist. Nothing was changed. Disable the branch instead.',
        'BRANCH_HAS_DEPENDENCIES',
        { stage, table: err?.table ?? null },
      );
    }
    throw new HttpError(500, 'BRANCH_DELETE_FAILED', 'Could not delete the branch because of a server error. Nothing was changed — please try again.');
  }

  // Alert email to the store owner (outside the transaction; a mail failure never undoes the delete)
  try {
    const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
    if (ownerEmail) {
      await enqueueDeletionAlertEmail(ctx.db, {
        tenantId,
        toEmail: ownerEmail,
        entityType: 'branch',
        entityName: branch.name,
        entityCode: branch.code,
        deletedByUserId: ctx.user!.id,
        deletedByUserName: ctx.user!.name,
        deletedByUserRole: ctx.user!.role,
        impactDetails: {
          countersCount: counters.length,
          cashiersCount: removable.filter((u) => u.role === 'cashier').length,
          managerName: manager ? manager.name : null,
        },
      });
    }
  } catch (err: any) {
    console.warn('[Branch Delete] Failed to enqueue deletion alert email:', err.message);
  }

  return { ok: true, deleted: branchId, branchName: branch.name, summary };
});
}
