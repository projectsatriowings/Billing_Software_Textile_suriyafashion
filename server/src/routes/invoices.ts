import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, HtmlResponse, FileResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { calcBill } from '../../../shared/tax.ts';
import { renderBillDoc, type PrintableBill } from '../../../shared/bill.ts';
import { stateName } from '../../../shared/states.ts';
import { DEFAULT_CONFIG } from '../../../shared/types.ts';
import { qrSvg, upiUri } from '../../../shared/qr.ts';
import { normalizePhone } from '../../../shared/whatsapp.ts';
import { audit } from '../audit.ts';
import { resolveBranchScope } from '../branchScope.ts';
import { invalidateTodayDashboardCache } from './dashboard.ts';
import { sendInvoiceBillSms } from '../services/smsService.ts';
import { generateInvoicePdf } from '../services/invoicePdfGenerator.ts';
import { syncItemStockStatus } from '../services/stockStatus.ts';

export function registerInvoices(r: Router) {
  // List invoices
  r.get('/api/invoices', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit ?? 50)));
    const q = (ctx.query.q ?? '').trim().toLowerCase();

    let sql = `
      SELECT i.*,
             COALESCE((SELECT json_agg(json_build_object('method', p.method, 'amountMinor', p.amount_minor))
                       FROM payments p WHERE p.invoice_id = i.id), '[]'::json) AS payments,
             COALESCE((SELECT json_agg(json_build_object('id', cn.id, 'number', cn.number, 'totalMinor', cn.total_minor, 'status', cn.status))
                       FROM invoices cn WHERE cn.linked_invoice_id = i.id AND cn.status = 'posted'), '[]'::json) AS credit_notes,
             COALESCE((SELECT SUM(cn.total_minor)
                       FROM invoices cn WHERE cn.linked_invoice_id = i.id AND cn.status = 'posted'), 0)::bigint AS returned_minor,
             COALESCE((SELECT bool_and(
               il.qty_milli <= COALESCE((
                 SELECT SUM(cl.qty_milli)
                 FROM invoice_lines cl
                 JOIN invoices cni ON cni.id = cl.invoice_id
                 WHERE cni.linked_invoice_id = i.id AND cni.status = 'posted' AND (cl.orig_line_id = il.id OR cl.item_id = il.item_id)
               ), 0)
             ) FROM invoice_lines il WHERE il.invoice_id = i.id), false) AS fully_returned
      FROM invoices i
      WHERE i.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];

    if (!scope.isSuperAdminAll && scope.branchId) {
      sql += ' AND i.branch_id = ?';
      params.push(scope.branchId);
    }

    if (q) {
      sql += ' AND (lower(i.number) LIKE ? OR lower(COALESCE(i.customer_name, \'\')) LIKE ? OR i.customer_phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY i.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await ctx.db.query(sql, params);
    return {
      invoices: rows.map((r: any) => ({
        id: r.id,
        branchId: r.branchId ?? r.branch_id,
        number: r.number,
        kind: r.kind,
        status: r.status,
        bdate: r.bdate,
        partyId: r.partyId ?? r.party_id,
        customerName: r.customerName ?? r.customer_name,
        customerPhone: r.customerPhone ?? r.customer_phone,
        totalMinor: Number(r.totalMinor ?? r.total_minor),
        taxableMinor: Number(r.taxableMinor ?? r.taxable_minor),
        cgstMinor: Number(r.cgstMinor ?? r.cgst_minor),
        sgstMinor: Number(r.sgstMinor ?? r.sgst_minor),
        igstMinor: Number(r.igstMinor ?? r.igst_minor),
        paidMinor: Number(r.paidMinor ?? r.paid_minor),
        balanceMinor: Number(r.balanceMinor ?? r.balance_minor),
        returnedMinor: Number(r.returnedMinor ?? r.returned_minor ?? 0),
        creditNotes: r.creditNotes || r.credit_notes || [],
        fullyReturned: Boolean(r.fullyReturned ?? r.fully_returned),
        linkedInvoiceId: r.linkedInvoiceId ?? r.linked_invoice_id,
        createdAt: r.createdAt ?? r.created_at,
        payments: r.payments || [],
        whatsappSendCount: Number(r.whatsappSendCount ?? r.whatsapp_send_count ?? 0),
        whatsappLastSentAt: r.whatsappLastSentAt ?? r.whatsapp_last_sent_at,
        whatsappLastSentTo: r.whatsappLastSentTo ?? r.whatsapp_last_sent_to,
        whatsappLastLanguage: r.whatsappLastLanguage ?? r.whatsapp_last_language,
        whatsappLastSentBy: r.whatsappLastSentBy ?? r.whatsapp_last_sent_by,
        location: r.location || 'MAIN',
        counter: r.counter || 'COUNTER-1',
        shareToken: r.shareToken ?? r.share_token,
        invoiceType: r.invoiceType ?? r.invoice_type ?? 'retail',
        isLateSale: Boolean(r.isLateSale ?? r.is_late_sale),
        lateSaleReason: r.lateSaleReason ?? r.late_sale_reason ?? null,
        lateSaleEntryAt: r.lateSaleEntryAt ?? r.late_sale_entry_at ?? null,
        lateSaleEnteredBy: r.lateSaleEnteredBy ?? r.late_sale_entered_by ?? null,
      })),
    };
  });

  // Get invoice details
  r.get('/api/invoices/:id', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];
    const inv = await ctx.db.one(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?${branchFilter}`, [ctx.params.id, tenantId, ...branchParams]);
    if (!inv) throw notFound('Invoice');

    const lines = await ctx.db.query('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC', [inv.id]);
    const payments = await ctx.db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    // Fetch linked credit notes (both posted and voided) for Returns zone (Section 4.2)
    const creditNotes = await ctx.db.query(
      `SELECT cn.*,
              u.name AS created_by_name,
              vu.name AS voided_by_name
       FROM invoices cn
       LEFT JOIN users u ON u.id = cn.created_by
       LEFT JOIN users vu ON vu.id = cn.voided_by
       WHERE cn.linked_invoice_id = ? AND cn.tenant_id = ?
       ORDER BY cn.created_at DESC`,
      [inv.id, tenantId],
    );

    let totalReturnedMinor = 0;
    const creditNotesWithDetails = [];
    for (const cn of creditNotes) {
      if (cn.status === 'posted') {
        totalReturnedMinor += Number(cn.totalMinor ?? cn.total_minor ?? 0);
      }
      const cnLines = await ctx.db.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC',
        [cn.id],
      );
      const cnAllocations = await ctx.db.query(
        `SELECT ca.*, i.number AS invoice_number
         FROM credit_allocations ca
         JOIN invoices i ON i.id = ca.invoice_id
         WHERE ca.credit_note_id = ?`,
        [cn.id],
      );
      creditNotesWithDetails.push({
        id: cn.id,
        number: cn.number,
        status: cn.status,
        bdate: cn.bdate,
        createdAt: cn.createdAt ?? cn.created_at,
        totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor),
        taxableTotalMinor: Number(cn.taxableMinor ?? cn.taxable_minor),
        cgstMinor: Number(cn.cgstMinor ?? cn.cgst_minor),
        sgstMinor: Number(cn.sgstMinor ?? cn.sgst_minor),
        igstMinor: Number(cn.igstMinor ?? cn.igst_minor),
        roundOffMinor: Number(cn.roundOffMinor ?? cn.round_off_minor),
        advanceAmountMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
        refundAmountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0),
        refundMode: cn.refundMode ?? cn.refund_mode,
        refundReference: cn.refundReference ?? cn.refund_reference,
        createdByName: cn.created_by_name,
        voidReason: cn.voidReason ?? cn.void_reason,
        voidedAt: cn.voidedAt ?? cn.voided_at,
        voidedByName: cn.voided_by_name,
        shareToken: cn.shareToken ?? cn.share_token,
        lines: cnLines.map((l: any) => ({
          id: l.id,
          name: l.name,
          qtyMilli: Number(l.qtyMilli ?? l.qty_milli),
          priceMinor: Number(l.priceMinor ?? l.price_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
          reason: l.reason,
          restock: Boolean(l.restock),
        })),
        allocations: cnAllocations.map((a: any) => ({
          invoiceId: a.invoice_id,
          invoiceNumber: a.invoice_number,
          amountMinor: Number(a.amount_minor),
        })),
      });
    }

    // Check if all lines are fully returned
    let isFullyReturned = lines.length > 0;
    const returnedLines = await ctx.db.query(
      `SELECT il.orig_line_id, il.item_id, il.name, SUM(il.qty_milli)::bigint AS returned_qty_milli
       FROM invoice_lines il
       JOIN invoices cn ON cn.id = il.invoice_id
       WHERE cn.linked_invoice_id = ? AND cn.tenant_id = ? AND cn.status = 'posted'
       GROUP BY il.orig_line_id, il.item_id, il.name`,
      [inv.id, tenantId],
    );
    const retMap = new Map<string, number>();
    for (const rl of returnedLines) {
      const origLineId = rl.origLineId ?? rl.orig_line_id;
      const itemId = rl.itemId ?? rl.item_id;
      const retQty = Number(rl.returnedQtyMilli ?? rl.returned_qty_milli ?? 0);
      if (origLineId) retMap.set(origLineId, (retMap.get(origLineId) ?? 0) + retQty);
      if (itemId) retMap.set(`item:${itemId}`, (retMap.get(`item:${itemId}`) ?? 0) + retQty);
      if (rl.name) retMap.set(`name:${rl.name}`, (retMap.get(`name:${rl.name}`) ?? 0) + retQty);
    }
    for (const l of lines) {
      const billed = Number(l.qtyMilli ?? l.qty_milli ?? 0);
      let ret = 0;
      const itemId = l.itemId ?? l.item_id;
      if (retMap.has(l.id)) ret = retMap.get(l.id)!;
      else if (itemId && retMap.has(`item:${itemId}`)) ret = retMap.get(`item:${itemId}`)!;
      else if (retMap.has(`name:${l.name}`)) ret = retMap.get(`name:${l.name}`)!;
      if (ret < billed) {
        isFullyReturned = false;
        break;
      }
    }

    return {
      fullyReturned: isFullyReturned,
      invoice: {
        ...inv,
        branchId: inv.branchId ?? inv.branch_id,
        partyId: inv.partyId ?? inv.party_id,
        customerName: inv.customerName ?? inv.customer_name,
        customerPhone: inv.customerPhone ?? inv.customer_phone,
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
        returnedMinor: totalReturnedMinor,
        fullyReturned: isFullyReturned,
        whatsappSendCount: Number(inv.whatsappSendCount ?? inv.whatsapp_send_count ?? 0),
        whatsappLastSentAt: inv.whatsappLastSentAt ?? inv.whatsapp_last_sent_at,
        whatsappLastSentTo: inv.whatsappLastSentTo ?? inv.whatsapp_last_sent_to,
        whatsappLastLanguage: inv.whatsappLastLanguage ?? inv.whatsapp_last_language,
        whatsappLastSentBy: inv.whatsappLastSentBy ?? inv.whatsapp_last_sent_by,
        shareToken: inv.shareToken ?? inv.share_token,
        invoiceType: inv.invoiceType ?? inv.invoice_type ?? 'retail',
        isLateSale: Boolean(inv.isLateSale ?? inv.is_late_sale),
        lateSaleReason: inv.lateSaleReason ?? inv.late_sale_reason ?? null,
        lateSaleEntryAt: inv.lateSaleEntryAt ?? inv.late_sale_entry_at ?? null,
        lateSaleEnteredBy: inv.lateSaleEnteredBy ?? inv.late_sale_entered_by ?? null,
        tender: (typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {}))?.tender || null,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        pos: l.pos,
        name: l.name,
        qtyMilli: Number(l.qtyMilli ?? l.qty_milli),
        priceMinor: Number(l.priceMinor ?? l.price_minor),
        discountMinor: Number(l.discountMinor),
        taxRateBp: Number(l.taxRateBp),
        taxableMinor: Number(l.taxableMinor),
        cgstMinor: Number(l.cgstMinor),
        sgstMinor: Number(l.sgstMinor),
        totalMinor: Number(l.totalMinor),
        unit: l.unit,
        hsn: l.hsn,
        variantId: l.variantId ?? l.variant_id ?? null,
        lineType: l.lineType ?? l.line_type ?? 'item',
        decimalQty: l.decimalQty != null || l.decimal_qty != null ? Number(l.decimalQty ?? l.decimal_qty) : null,
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        method: p.method,
        amountMinor: Number(p.amountMinor),
        reference: p.reference,
        createdAt: p.createdAt,
      })),
      creditNotes: creditNotesWithDetails,
    };
  });

  // Create new bill (POS Checkout)
  r.post('/api/invoices', requirePerm('sell'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const isWholesale = (b.invoiceType || b.invoice_type) === 'wholesale';
    const isLateSale = Boolean(b.isLateSale ?? b.is_late_sale);
    const lateSaleBusinessDate = isLateSale ? String(b.businessDate ?? b.business_date ?? b.bdate ?? '').trim() : null;
    const lateSaleReason = isLateSale ? String(b.lateSaleReason ?? b.late_sale_reason ?? b.reason ?? 'Post-day-close customer purchase').trim() : null;

    if (isLateSale) {
      const userRole = String(ctx.user!.role || '').toLowerCase();
      const isAuthorized = ['owner', 'super_admin', 'store_manager', 'manager', 'admin'].includes(userRole);
      if (!isAuthorized) {
        throw bad('Only Store Managers and Owners are authorized to enter Late Sales for closed business dates.', 'FORBIDDEN');
      }
      if (!lateSaleBusinessDate || !/^\d{4}-\d{2}-\d{2}$/.test(lateSaleBusinessDate)) {
        throw bad('A valid closed business date (YYYY-MM-DD) is required for Late Sale Entry.', 'INVALID_BUSINESS_DATE');
      }
      const todayIsoStr = new Date().toISOString().slice(0, 10);
      if (lateSaleBusinessDate >= todayIsoStr) {
        throw bad('Late Sale Entry is only permitted for previously closed past dates.', 'DATE_NOT_CLOSED');
      }
    }

    // POS billing requires an open cashier shift; wholesale billing and late sales do not require an active shift
    const activeShift = await ctx.db.one<any>(
      "SELECT id, branch_id, counter_id, counter, counter_name_snapshot FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = 'open' FOR SHARE",
      [tenantId, ctx.user!.id],
    );
    if (!activeShift && !isWholesale && !isLateSale) {
      throw bad('An open cashier shift is required to create a bill. Please start your shift at POS Counter.', 'SHIFT_REQUIRED');
    }
    let invoiceBranchId = activeShift?.branchId ?? activeShift?.branch_id ?? b.branchId ?? b.branch_id ?? ctx.user!.branchId;
    if (!invoiceBranchId) {
      const fallbackBr = await ctx.db.one<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (code = 'MAIN') DESC, created_at ASC LIMIT 1",
        [tenantId],
      );
      invoiceBranchId = fallbackBr?.id || null;
    }
    if (!invoiceBranchId) {
      throw bad('Branch is required for bill creation. Please link your shift or account to a branch.', 'BRANCH_REQUIRED');
    }
    // Normalise the branch reference: shifts/users may store either the branch id or its code.
    // Resolve to the canonical id and keep the code so stock lookups match the Products page.
    const invoiceBranchRow = await ctx.db.one<{ id: string; code: string }>(
      'SELECT id, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) LIMIT 1',
      [tenantId, invoiceBranchId, invoiceBranchId],
    );
    if (invoiceBranchRow?.id) invoiceBranchId = invoiceBranchRow.id;
    const invoiceBranchCode: string = invoiceBranchRow?.code || String(invoiceBranchId);

    let closedDayRecord: any = null;
    if (isLateSale) {
      closedDayRecord = await ctx.db.one<any>(
        `SELECT id, bdate, status, closed_at, gross_sales_minor, actual_cash_minor
         FROM day_closings
         WHERE tenant_id = ? AND (branch_id = ? OR branch_id = ?) AND bdate = ? AND status IN ('closed', 'approved', 'submitted')
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, invoiceBranchId, invoiceBranchCode, lateSaleBusinessDate],
      );
      if (!closedDayRecord) {
        throw bad(`No completed Day Close record found for business date ${lateSaleBusinessDate}. Late sale entry is only permitted for closed dates.`, 'DAY_NOT_CLOSED');
      }
    }

    const linesInput = V.arr(b.lines, 'Bill items', { min: 1 });
    const paymentsInput = V.arr(b.payments ?? [], 'Payments');
    let partyId = V.optStr(b.partyId ?? b.party_id ?? b.customerId ?? b.customer_id, 'Customer party', 50);
    let customerName = V.optStr(b.customerName ?? b.customer_name ?? b.customer?.name, 'Customer name', 100);
    let customerPhone = V.optStr(b.customerPhone ?? b.customer_phone ?? b.customer?.phone, 'Customer phone', 20);
    let customerGstin = V.optStr(b.customerGstin ?? b.customer_gstin ?? b.customer?.gstin ?? b.custom?.customerGstin, 'Customer GSTIN', 20);
    let customerAddress = V.optStr(b.billingAddress ?? b.customer?.address ?? b.custom?.billingAddress, 'Billing address', 500);
    let customerShippingAddress = V.optStr(b.shippingAddress ?? b.customer?.shippingAddress ?? b.custom?.shippingAddress, 'Shipping address', 500);
    let customerContactPerson = V.optStr(b.contactPerson ?? b.customer?.contactPerson ?? b.custom?.contactPerson, 'Contact person', 100);
    let customerStateCode = V.optStr(b.customerStateCode ?? b.customer?.stateCode ?? b.custom?.customerStateCode, 'Customer state code', 10);
    let customerState = V.optStr(b.customerState ?? b.customer?.stateName ?? b.custom?.customerState, 'Customer state', 100);
    const redeemedPoints = Math.max(0, V.int(b.redeemedPoints ?? 0, 'Redeemed points', { min: 0 }));
    const billDiscountMinor = V.int(b.billDiscountMinor ?? 0, 'Bill discount', { min: 0 });
    const appliedPromotionsInput = Array.isArray(b.appliedPromotions) ? b.appliedPromotions : [];
    const promotionDiscountMinor = V.int(b.promotionDiscountMinor ?? 0, 'Promotion discount', { min: 0 });

    let partyRow: any = null;
    let wholesaleCustomerId = V.optStr(
      b.wholesaleCustomerId ?? b.wholesale_customer_id ?? (isWholesale ? (b.partyId ?? b.party_id ?? b.customerId ?? b.customer_id) : null),
      'Wholesale customer',
      50
    );
    let wholesaleCustomerRow: any = null;

    if (isWholesale) {
      if (!wholesaleCustomerId) {
        throw bad('Please select a wholesale customer from the Wholesale Customers table for B2B billing.', 'VALIDATION', { field: 'wholesaleCustomerId' });
      }
      wholesaleCustomerRow = await ctx.db.one<any>(
        'SELECT id, name, company_name, contact_person, phone, email, gstin, state_code, billing_address, shipping_address, credit_limit_minor, custom FROM wholesale_customers WHERE id = ? AND tenant_id = ?',
        [wholesaleCustomerId, tenantId]
      );
      if (!wholesaleCustomerRow) {
        throw bad('Selected customer does not exist in Wholesale Customers table. Please select a valid wholesale customer.', 'NOT_FOUND');
      }
      if (!customerName) customerName = wholesaleCustomerRow.name || wholesaleCustomerRow.companyName || wholesaleCustomerRow.company_name;
      if (!customerPhone) customerPhone = wholesaleCustomerRow.phone;
      if (!customerGstin) customerGstin = wholesaleCustomerRow.gstin;
      if (!customerAddress) customerAddress = wholesaleCustomerRow.billingAddress || wholesaleCustomerRow.billing_address || wholesaleCustomerRow.address;
      if (!customerShippingAddress) customerShippingAddress = wholesaleCustomerRow.shippingAddress || wholesaleCustomerRow.shipping_address || customerAddress;
      if (!customerContactPerson) customerContactPerson = wholesaleCustomerRow.contactPerson || wholesaleCustomerRow.contact_person;
      if (!customerStateCode) customerStateCode = wholesaleCustomerRow.stateCode || wholesaleCustomerRow.state_code || (wholesaleCustomerRow.gstin ? wholesaleCustomerRow.gstin.slice(0, 2) : null);
    } else if (partyId) {
      partyRow = await ctx.db.one<any>(
        'SELECT id, name, phone, email, gstin, state_code, address, custom FROM parties WHERE id = ? AND tenant_id = ?',
        [partyId, tenantId]
      );
      if (partyRow) {
        const partyCustom = (partyRow.custom && typeof partyRow.custom === 'object') ? partyRow.custom : {};
        if (!customerName) customerName = partyRow.name;
        if (!customerPhone) customerPhone = partyRow.phone;
        if (!customerGstin) customerGstin = partyRow.gstin;
        if (!customerAddress) customerAddress = partyRow.address;
        if (!customerStateCode) customerStateCode = partyRow.state_code || (partyRow.gstin ? partyRow.gstin.slice(0, 2) : null);
        if (!customerContactPerson) customerContactPerson = partyCustom.contactPerson || null;
        if (!customerShippingAddress) customerShippingAddress = partyCustom.shippingAddress || customerAddress;
      }
    }

    const cleanPhoneDigits = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : '';
    if (!partyId && cleanPhoneDigits) {
      const match = await ctx.db.one<any>(
        `SELECT id, name, phone, email, gstin, state_code, address, custom FROM parties 
         WHERE tenant_id = ? AND branch_id = ? AND type = 'customer' 
           AND (phone = ? OR REPLACE(phone, ' ', '') LIKE ? OR phone LIKE ?) 
         LIMIT 1`,
        [tenantId, invoiceBranchId, customerPhone, `%${cleanPhoneDigits}`, `%${cleanPhoneDigits}`]
      );
      if (match) {
        partyId = match.id;
        partyRow = match;
        const matchCustom = (match.custom && typeof match.custom === 'object') ? match.custom : {};
        if (!customerName) customerName = match.name;
        if (!customerPhone) customerPhone = match.phone;
        if (!customerGstin) customerGstin = match.gstin;
        if (!customerAddress) customerAddress = match.address;
        if (!customerStateCode) customerStateCode = match.state_code || (match.gstin ? match.gstin.slice(0, 2) : null);
        if (!customerContactPerson) customerContactPerson = matchCustom.contactPerson || null;
        if (!customerShippingAddress) customerShippingAddress = matchCustom.shippingAddress || customerAddress;
      }
    }

    if (!customerStateCode && customerGstin && customerGstin.trim().length >= 2) {
      customerStateCode = customerGstin.trim().slice(0, 2);
    }
    if (!customerState && customerStateCode) {
      customerState = stateName(customerStateCode);
    }

    const tenderInput = b.tender;
    let tenderData: { cashReceivedMinor: number; changeReturnedMinor: number } | null = null;
    if (tenderInput && typeof tenderInput === 'object') {
      const cashRec = V.int(tenderInput.cashReceivedMinor ?? 0, 'Cash received', { min: 0 });
      if (cashRec > 0) {
        tenderData = {
          cashReceivedMinor: cashRec,
          changeReturnedMinor: Math.max(0, cashRec - (b.totalMinor ?? 0)),
        };
      }
    }

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const shopState = String(shop.stateCode ?? shop.state_code ?? '33');
    const placeState = customerStateCode || b.placeState || shopState;
    const isIntra = b.intra !== undefined
      ? Boolean(b.intra)
      : (customerStateCode ? customerStateCode === shopState : true);
    const isGstEnabled = Boolean(shop.gst_enabled ?? shop.gstEnabled ?? false);

    const formattedLines = linesInput.map((l: any, i: number) => {
      const name = V.str(l.name, `Item ${i + 1} name`, { required: true, max: 120 });
      const qtyMilli = V.int(l.qtyMilli, `Item ${i + 1} quantity`, { min: 1, required: true });
      const priceMinor = V.int(l.priceMinor, `Item ${i + 1} price`, { min: 0, required: true });
      const discountMinor = V.int(l.discountMinor ?? 0, `Item ${i + 1} discount`, { min: 0 });
      const lineType = V.optStr(l.lineType ?? l.line_type, 'Line type', 30) || 'item';
      const variantId = V.optStr(l.variantId ?? l.variant_id, 'Variant ID', 60);
      const decimalQty = l.decimalQty != null ? Number(l.decimalQty) : (qtyMilli / 1000);

      let taxRateBp = 0;
      let hsn = V.optStr(l.hsn, 'HSN', 20);

      if (!isGstEnabled) {
        taxRateBp = 0;
      } else if (l.taxRateBpOverride != null || l.overrideTaxRateBp != null) {
        taxRateBp = V.int(l.taxRateBpOverride ?? l.overrideTaxRateBp, `Item ${i + 1} tax rate`, { min: 0, max: 10000 });
      } else if (lineType === 'cutting_charge' || lineType === 'tailoring') {
        taxRateBp = 500; // 5% SAC 9988
        if (!hsn) hsn = '9988';
      } else {
        // Slab-based GST: 5% up to Rs. 2,500/piece, 18% above, resolved on the billed price after discount
        const effectiveBilledPricePerPiece = (qtyMilli > 0) ? Math.round(((priceMinor * qtyMilli / 1000) - discountMinor) / (qtyMilli / 1000)) : priceMinor;
        taxRateBp = effectiveBilledPricePerPiece <= 250000 ? 500 : 1800;
        if (!hsn) hsn = '6204';
      }

      const inclusive = false;
      const itemId = V.optStr(l.itemId, 'Item ID', 50);
      const unit = V.optStr(l.unit, 'Unit', 20);
      const isTemporary = Boolean(l.isTemporary ?? l.is_temporary ?? (lineType === 'temporary'));
      const supplierInvoiceNumber = V.optStr(l.supplierInvoiceNumber ?? l.supplier_invoice_number, 'Supplier invoice number', 100);
      return { name, qtyMilli, priceMinor, discountMinor, taxRateBp, inclusive, itemId, unit, hsn, variantId, lineType, decimalQty, isTemporary, supplierInvoiceNumber };
    });

    const calculated = calcBill(
      formattedLines.map((l) => ({
        name: l.name,
        qtyMilli: l.qtyMilli,
        priceMinor: l.priceMinor,
        discountMinor: l.discountMinor,
        taxRateBp: l.taxRateBp,
        inclusive: false,
      })),
      {
        intraState: isIntra,
        billDiscountMinor,
        roundTotal: 'rupee',
      },
    );

    const invoiceId = newId('inv');
    const shareToken = newId('tok');
    const todayStr = new Date().toISOString().slice(0, 10);
    const invoiceBdate = isLateSale ? lateSaleBusinessDate! : todayStr;

    let assignedNumber = '';
    let totalPaidMinor = 0;
    let location = V.optStr(b.location, 'Location', 50);
    if (!location) {
      const br = await ctx.db.one<any>('SELECT code FROM branches WHERE id = ?', [invoiceBranchId]);
      location = br?.code || ctx.user!.assignedLocation || 'MAIN';
    }
    const inputCounterId = V.optStr(b.counterId ?? b.counter_id, 'counterId', 50);
    const inputCounter = V.optStr(b.counter, 'Counter', 50);

    let resolvedCounterId: string | null = null;
    let resolvedCounterCode: string = inputCounter || activeShift?.counter || (isWholesale ? 'WHOLESALE' : 'COUNTER-1');
    let resolvedCounterName: string = inputCounter || activeShift?.counterNameSnapshot || activeShift?.counter_name_snapshot || (isWholesale ? 'Wholesale Desk' : 'Counter 1');

    let counterRow: any = null;
    if (invoiceBranchId) {
      if (inputCounterId) {
        counterRow = await ctx.db.one<any>(
          'SELECT id, name, code, status FROM counters WHERE tenant_id = ? AND branch_id = ? AND id = ?',
          [tenantId, invoiceBranchId, inputCounterId],
        );
      }
      if (!counterRow && inputCounter) {
        counterRow = await ctx.db.one<any>(
          'SELECT id, name, code, status FROM counters WHERE tenant_id = ? AND branch_id = ? AND (upper(code) = upper(?) OR lower(name) = lower(?))',
          [tenantId, invoiceBranchId, inputCounter, inputCounter],
        );
      }

      // If client explicitly passed a counter that doesn't exist in this branch:
      if (!counterRow && (inputCounterId || inputCounter)) {
        const branchCounters = await ctx.db.query<any>(
          'SELECT id, name, code, status FROM counters WHERE tenant_id = ? AND branch_id = ?',
          [tenantId, invoiceBranchId],
        );
        if (branchCounters.length > 0) {
          throw bad(`Billing counter "${inputCounter || inputCounterId}" does not belong to this branch.`, 'INVALID_COUNTER');
        }
      }

      // Only if client did NOT supply a counter in body, fallback to active shift's counter
      if (!counterRow && !inputCounterId && !inputCounter) {
        if (activeShift?.counterId || activeShift?.counter_id) {
          counterRow = await ctx.db.one<any>(
            'SELECT id, name, code, status FROM counters WHERE tenant_id = ? AND branch_id = ? AND id = ?',
            [tenantId, invoiceBranchId, activeShift.counterId ?? activeShift.counter_id],
          );
        }
        if (!counterRow && activeShift?.counter) {
          counterRow = await ctx.db.one<any>(
            'SELECT id, name, code, status FROM counters WHERE tenant_id = ? AND branch_id = ? AND (upper(code) = upper(?) OR lower(name) = lower(?))',
            [tenantId, invoiceBranchId, activeShift.counter, activeShift.counter],
          );
        }
      }

      if (counterRow) {
        if (counterRow.status === 'DISABLED') {
          throw bad(`Billing counter "${counterRow.name}" is currently disabled. Please select an active counter.`, 'COUNTER_DISABLED');
        }
        resolvedCounterId = counterRow.id;
        resolvedCounterCode = counterRow.code;
        resolvedCounterName = counterRow.name;
      }
    }
    let earnedLoyaltyPoints = 0;
    let customerLoyaltyPoints: number | null = null;
    let isNewCustomer = false;

    await ctx.db.tx(async (q) => {
      // 0a. Validate branch stock availability before committing invoice or number series
      const itemQtyRequestedMap = new Map<string, number>();
      for (const line of formattedLines) {
        if (line.itemId) {
          itemQtyRequestedMap.set(line.itemId, (itemQtyRequestedMap.get(line.itemId) || 0) + line.qtyMilli);
        }
      }

      for (const [itemId, requestedMilli] of itemQtyRequestedMap.entries()) {
        const itemRow = await q.one<any>(
          'SELECT id, name, track_stock, branch_id FROM items WHERE id = ? AND tenant_id = ? FOR UPDATE',
          [itemId, tenantId]
        );
        const isTracked = itemRow && itemRow.trackStock !== false && itemRow.track_stock !== false;
        if (isTracked) {
          // Must match the branch-stock formula used by GET /api/items (Products page / POS catalog):
          // moves tagged with this branch, plus legacy moves with no branch_id whose location is this branch.
          const stockRow = await q.one<any>(
            `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS current_stock_milli
             FROM stock_moves
             WHERE tenant_id = ? AND item_id = ? AND (
               branch_id = ?
               OR UPPER(branch_id) = UPPER(?)
               OR (branch_id IS NULL AND (UPPER(location) = UPPER(?) OR UPPER(location) = UPPER(?)))
             )`,
            [tenantId, itemId, invoiceBranchId, invoiceBranchCode, invoiceBranchCode, invoiceBranchId]
          );
          const currentStockMilli = BigInt(stockRow?.currentStockMilli ?? stockRow?.current_stock_milli ?? 0);
          const reqMilli = BigInt(requestedMilli);
          if (currentStockMilli < reqMilli) {
            const availableUnits = Math.max(0, Math.floor(Number(currentStockMilli) / 1000));
            throw bad(
              `Insufficient stock for "${itemRow.name}". Only ${availableUnits} unit${availableUnits === 1 ? '' : 's'} available in this branch.`,
              'INSUFFICIENT_STOCK',
              {
                itemId: itemRow.id,
                itemName: itemRow.name,
                availableUnits,
                requestedUnits: Number(reqMilli) / 1000,
                availableStockMilli: Number(currentStockMilli),
                requestedQtyMilli: Number(reqMilli),
              }
            );
          }
        }
      }

      // 0. Auto-enroll new customer if phone was given at counter and party does not exist yet
      if (!partyId && cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
        const existingParty = await q.one<{ id: string }>(
          `SELECT id FROM parties 
           WHERE tenant_id = ? AND branch_id = ? AND type = 'customer' 
             AND (phone = ? OR REPLACE(phone, ' ', '') LIKE ? OR phone LIKE ?) 
           LIMIT 1`,
          [tenantId, invoiceBranchId, (customerPhone || cleanPhoneDigits).trim(), `%${cleanPhoneDigits}`, `%${cleanPhoneDigits}`]
        );
        if (existingParty) {
          partyId = existingParty.id;
        } else {
          isNewCustomer = true;
          const newCustId = newId('p');
          const assignedCustName = (customerName && customerName.trim() && !customerName.toLowerCase().includes('walk-in'))
            ? customerName.trim()
            : `Customer ${cleanPhoneDigits.slice(-4)}`;

          await q.exec(
            `INSERT INTO parties (
              id, tenant_id, branch_id, type, name, phone, state_code, loyalty_points, active, custom
            ) VALUES (?, ?, ?, 'customer', ?, ?, ?, 0, true, '{}'::jsonb)`,
            [newCustId, tenantId, invoiceBranchId, assignedCustName, (customerPhone || cleanPhoneDigits).trim(), shop.stateCode ?? shop.state_code ?? '33']
          );
          partyId = newCustId;
        }
      }

      // 1. Generate sequential invoice number ensuring zero duplicate collisions across tenant
      const branchSeriesRow = await q.one<{ series: string }>(
        "SELECT series FROM number_series WHERE tenant_id = ? AND branch_id = ? AND series NOT IN ('SHF', 'TRF', 'EXP', 'PUR', 'STC', 'ADJ', 'CNT') ORDER BY series = ? DESC LIMIT 1",
        [tenantId, invoiceBranchId, shop.invoicePrefix || '']
      );
      const rawShopProfiles = shop.invoiceProfiles ?? shop.invoice_profiles;
      const shopProfiles = typeof rawShopProfiles === 'string' ? JSON.parse(rawShopProfiles) : (rawShopProfiles || null);
      let prefix: string;
      if (isWholesale) {
        prefix = (shopProfiles?.wholesale?.invoicePrefix || 'WH').trim().toUpperCase();
      } else {
        prefix = (shopProfiles?.retail?.invoicePrefix || branchSeriesRow?.series || '').trim().toUpperCase();
        if (!prefix) {
          const branchRow = await q.one<{ code: string }>(
            'SELECT code FROM branches WHERE id = ? AND tenant_id = ?',
            [invoiceBranchId, tenantId]
          );
          prefix = (branchRow?.code && branchRow.code !== 'MAIN') ? branchRow.code : (shop.invoicePrefix ?? shop.invoice_prefix ?? 'INV');
        }
      }

      while (true) {
        const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
          `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
           VALUES (?, ?, ?, 2)
           ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = number_series.next_no + 1
           RETURNING (next_no - 1) AS assigned_no`,
          [tenantId, invoiceBranchId, prefix],
        );
        const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
        const candidate = `${prefix}-${1000 + seqNo}`;
        const collision = await q.one<{ id: string }>('SELECT id FROM invoices WHERE tenant_id = ? AND number = ? LIMIT 1', [tenantId, candidate]);
        if (!collision) {
          assignedNumber = candidate;
          break;
        }
      }

      // 2. Payments calculation
      for (const p of paymentsInput) {
        const rawM = (p.method ?? p.mode ?? '').toLowerCase();
        if (rawM === 'credit') continue;
        const amt = V.int(p.amountMinor, 'Payment amount', { min: 1 });
        totalPaidMinor += amt;
      }
      const balanceMinor = Math.max(0, calculated.totalMinor - totalPaidMinor);

      // Validate customer credit limit if there is an unpaid balance
      if (isWholesale && (wholesaleCustomerId || wholesaleCustomerRow?.id) && balanceMinor > 0) {
        const targetWcId = wholesaleCustomerRow?.id || wholesaleCustomerId;
        const wcRow = await q.one<any>(
          `SELECT w.id, w.name, w.credit_limit_minor,
                  COALESCE((SELECT SUM(i.balance_minor) FROM invoices i WHERE (i.wholesale_customer_id = w.id OR i.party_id = w.id) AND i.tenant_id = w.tenant_id AND i.status = 'posted'), 0)::bigint AS unpaid_minor
           FROM wholesale_customers w
           WHERE w.id = ? AND w.tenant_id = ? FOR UPDATE`,
          [targetWcId, tenantId],
        );
        if (wcRow) {
          const credLimit = Number(wcRow.creditLimitMinor ?? wcRow.credit_limit_minor ?? 0);
          if (credLimit > 0) {
            const unpaid = Number(wcRow.unpaidMinor ?? wcRow.unpaid_minor ?? 0);
            const currentDues = unpaid;
            const futureDues = currentDues + balanceMinor;
            if (futureDues > credLimit) {
              const availCredit = Math.max(0, credLimit - currentDues);
              throw bad(
                `Wholesale customer credit limit of ₹${(credLimit / 100).toFixed(2)} exceeded for "${wcRow.name}". Outstanding dues: ₹${(currentDues / 100).toFixed(2)}, available credit: ₹${(availCredit / 100).toFixed(2)}.`,
                'CREDIT_LIMIT_EXCEEDED',
                { creditLimitMinor: credLimit, currentDuesMinor: currentDues, availableCreditMinor: availCredit }
              );
            }
          }
        }
      } else if (!isWholesale && partyId && balanceMinor > 0) {
        const partyRow = await q.one<any>(
          `SELECT p.id, p.name, p.credit_limit_minor,
                  COALESCE((SELECT SUM(i.balance_minor) FROM invoices i WHERE i.party_id = p.id AND i.tenant_id = p.tenant_id AND i.status = 'posted'), 0)::bigint AS unpaid_minor,
                  p.advance_minor
           FROM parties p
           WHERE p.id = ? AND p.tenant_id = ? FOR UPDATE`,
          [partyId, tenantId],
        );
        if (partyRow) {
          const credLimit = Number(partyRow.creditLimitMinor ?? partyRow.credit_limit_minor ?? 0);
          if (credLimit > 0) {
            const unpaid = Number(partyRow.unpaidMinor ?? partyRow.unpaid_minor ?? 0);
            const adv = Number(partyRow.advanceMinor ?? partyRow.advance_minor ?? 0);
            const currentDues = Math.max(0, unpaid - adv);
            const futureDues = currentDues + balanceMinor;
            if (futureDues > credLimit) {
              const availCredit = Math.max(0, credLimit - currentDues);
              throw bad(
                `Customer credit limit of ₹${(credLimit / 100).toFixed(2)} exceeded for "${partyRow.name}". Outstanding dues: ₹${(currentDues / 100).toFixed(2)}, available credit: ₹${(availCredit / 100).toFixed(2)}.`,
                'CREDIT_LIMIT_EXCEEDED',
                { creditLimitMinor: credLimit, currentDuesMinor: currentDues, availableCreditMinor: availCredit }
              );
            }
          }
        }
      }

      // Active shift already verified prior to transaction

      // 3. Insert invoice
      if (tenderData) {
        tenderData.changeReturnedMinor = Math.max(0, tenderData.cashReceivedMinor - calculated.totalMinor);
      }

      const paymentStatus = balanceMinor === 0 ? 'paid' : (totalPaidMinor > 0 ? 'partial' : 'unpaid');

      const invoiceCustom = {
        ...(tenderData ? { tender: tenderData } : {}),
        ...(isLateSale ? {
          isLateSale: true,
          lateSaleReason,
          businessDate: invoiceBdate,
          entryDateTime: new Date().toISOString(),
          enteredBy: ctx.user!.id,
          enteredByName: ctx.user!.name || ctx.user!.email,
        } : {}),
        ...(b.custom && typeof b.custom === 'object' ? b.custom : {}),
        ...(isWholesale ? {
          invoiceType: 'wholesale',
          paymentTerms: b.custom?.paymentTerms || b.paymentTerms || null,
          customerGstin: customerGstin || null,
          customerState: customerState || null,
          customerStateCode: customerStateCode || null,
          billingAddress: customerAddress || null,
          shippingAddress: customerShippingAddress || customerAddress || null,
          contactPerson: customerContactPerson || null,
        } : {}),
      };

      const profileSnapshot = isWholesale ? (shopProfiles?.wholesale || null) : (shopProfiles?.retail || null);

      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, branch_id, client_id, number, kind, status, bdate, party_id, wholesale_customer_id,
          customer_name, customer_phone, customer_gstin, party_name, party_phone, place_state, intra,
          subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor,
          round_off_minor, rounding_minor, total_minor,
          paid_minor, balance_minor, payment_status, rule_version, calc, share_token, created_by, location, counter, counter_id, counter_name_snapshot, shift_id, custom,
          applied_promotions, promotion_discount_minor,
          invoice_type, profile_snapshot,
          is_late_sale, late_sale_reason, late_sale_entry_at, late_sale_entered_by
        ) VALUES (
          ?, ?, ?, ?, ?, 'sale', 'posted', ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, '1.0', ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?::jsonb,
          ?::jsonb, ?,
          ?, ?::jsonb,
          ?, ?, ?, ?
        )`,
        [
          invoiceId,
          tenantId,
          invoiceBranchId,
          newId('cid'),
          assignedNumber,
          invoiceBdate,
          isWholesale ? null : (partyId || null),
          isWholesale ? (wholesaleCustomerRow?.id || wholesaleCustomerId || null) : null,
          customerName || null,
          customerPhone || null,
          customerGstin || null,
          customerName || null,
          customerPhone || null,
          placeState,
          isIntra,
          calculated.subtotalMinor,
          billDiscountMinor,
          calculated.taxableMinor,
          calculated.cgstMinor,
          calculated.sgstMinor,
          calculated.igstMinor,
          calculated.roundOffMinor,
          calculated.roundOffMinor,
          calculated.totalMinor,
          totalPaidMinor,
          balanceMinor,
          paymentStatus,
          j(calculated),
          shareToken,
          ctx.user!.id,
          location,
          resolvedCounterCode,
          resolvedCounterId,
          resolvedCounterName,
          isLateSale ? null : (activeShift?.id || null),
          j(invoiceCustom),
          j(appliedPromotionsInput),
          promotionDiscountMinor,
          isWholesale ? 'wholesale' : 'retail',
          j(profileSnapshot),
          isLateSale,
          isLateSale ? lateSaleReason : null,
          isLateSale ? new Date() : null,
          isLateSale ? ctx.user!.id : null,
        ],
      );

      // 3.5 Record promotion usage and atomic usage limit check
      for (const promoItem of appliedPromotionsInput) {
        if (promoItem.promotionId) {
          const promo = await q.one<{ id: string; max_total_usage: number | null; current_usage_count: number }>(
            'SELECT id, max_total_usage, current_usage_count FROM promotions WHERE id = ? AND tenant_id = ? FOR UPDATE',
            [promoItem.promotionId, tenantId]
          );
          if (promo) {
            if (promo.max_total_usage && promo.current_usage_count >= promo.max_total_usage) {
              throw bad(`Promotion "${promoItem.promotionName || promo.id}" has reached its maximum usage limit.`);
            }
            await q.exec(
              `UPDATE promotions
               SET current_usage_count = current_usage_count + 1,
                   status = CASE WHEN max_total_usage IS NOT NULL AND current_usage_count + 1 >= max_total_usage THEN 'expired' ELSE status END,
                   updated_at = now()
               WHERE id = ? AND tenant_id = ?`,
              [promoItem.promotionId, tenantId]
            );
            await q.exec(
              `INSERT INTO promotion_usage (
                 id, tenant_id, promotion_id, invoice_id, party_id, customer_phone, discount_minor, branch, counter, applied_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
              [
                newId('pu'),
                tenantId,
                promoItem.promotionId,
                invoiceId,
                partyId || null,
                customerPhone || null,
                Math.max(0, Number(promoItem.discountMinor || 0)),
                location,
                resolvedCounterCode,
              ]
            );
          }
        }
      }

      // 4. Insert lines and update inventory
      for (let i = 0; i < formattedLines.length; i++) {
        const item = formattedLines[i];
        const calcL = calculated.lines[i];
        const lineId = newId('inl');

        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, branch_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
            variant_id, line_type, decimal_qty, is_temporary, supplier_invoice_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            tenantId,
            invoiceBranchId,
            invoiceId,
            i + 1,
            item.itemId || null,
            item.name,
            item.hsn || null,
            item.unit || null,
            item.qtyMilli,
            item.priceMinor,
            calcL.discountMinor,
            item.taxRateBp,
            item.inclusive,
            calcL.taxableMinor,
            calcL.cgstMinor,
            calcL.sgstMinor,
            calcL.igstMinor,
            calcL.totalMinor,
            item.variantId || null,
            item.lineType || 'item',
            item.decimalQty != null ? item.decimalQty : (item.qtyMilli / 1000),
            Boolean(item.isTemporary),
            item.supplierInvoiceNumber || null,
          ],
        );

        // Record temporary product sale line for later supplier invoice reconciliation
        if (item.isTemporary && item.supplierInvoiceNumber) {
          const tpsId = newId('tps');
          const soldQty = item.decimalQty != null ? Number(item.decimalQty) : (item.qtyMilli / 1000);
          const normalizedName = item.name.trim().toLowerCase().replace(/\s+/g, ' ');
          await q.exec(
            `INSERT INTO temporary_product_sales (
              id, tenant_id, branch_id, invoice_id, invoice_line_id,
              supplier_invoice_number, product_name, normalized_name,
              selling_price_minor, sold_qty_milli, sold_quantity, reconciled_quantity, remaining_quantity,
              reconciliation_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', now(), now())`,
            [
              tpsId,
              tenantId,
              invoiceBranchId,
              invoiceId,
              lineId,
              String(item.supplierInvoiceNumber).trim().toUpperCase(),
              item.name.trim(),
              normalizedName,
              item.priceMinor,
              item.qtyMilli,
              soldQty,
              soldQty,
            ],
          );
        }

        // Deduct variant stock if variantId is set
        if (item.variantId) {
          await q.exec(
            `UPDATE variants SET stock_milli = stock_milli - ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
            [item.qtyMilli, item.variantId, tenantId],
          );
        }

        // Deduct inventory at the sale's branch location (verifying item exists to prevent foreign key errors)
        if (item.itemId) {
          const itemExists = await q.one('SELECT id FROM items WHERE id = ? AND tenant_id = ? LIMIT 1', [item.itemId, tenantId]);
          if (itemExists) {
            await q.exec(
              `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, bdate, notes, variant_id)
               VALUES (?, ?, ?, ?, ?, ?, 'sale', 'invoice', ?, ?, ?, ?, ?)`,
              [newId('sm'), tenantId, invoiceBranchId, item.itemId, location, -item.qtyMilli, invoiceId, ctx.user!.id, invoiceBdate, isLateSale ? `Late Sale (${invoiceBdate}): ${lateSaleReason}` : null, item.variantId || null],
            );
          }
        }
      }

      // Synchronize product status based on remaining stock (auto-deactivates zero-stock items)
      const billedItemIds = formattedLines.map((l) => l.itemId).filter(Boolean) as string[];
      if (billedItemIds.length > 0) {
        await syncItemStockStatus(q, tenantId, billedItemIds, invoiceBranchId);
      }

      // 5. Insert payments
      for (const p of paymentsInput) {
        const rawMethod = (p.method ?? p.mode ?? 'cash').toLowerCase();
        if (rawMethod === 'credit') continue;
        const amt = V.int(p.amountMinor, 'Payment amount', { min: 1 });
        const method = V.oneOf(rawMethod, 'Payment method', ['cash', 'upi', 'card', 'bank', 'advance'] as const, 'cash');

        if (method === 'advance') {
          if (!partyId) {
            throw bad('Customer party required to use customer advance payment.');
          }
          const party = await q.one('SELECT advance_minor FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE', [partyId, tenantId]);
          const currentAdv = Number(party?.advanceMinor ?? party?.advance_minor ?? 0);
          if (currentAdv < amt) {
            throw bad(`Insufficient customer advance. Available: ₹${(currentAdv / 100).toFixed(2)}, Requested: ₹${(amt / 100).toFixed(2)}`);
          }
          await q.exec(
            'UPDATE parties SET advance_minor = advance_minor - ? WHERE id = ? AND tenant_id = ?',
            [amt, partyId, tenantId],
          );
        }

        await q.exec(
          `INSERT INTO payments (id, tenant_id, branch_id, kind, method, mode, amount_minor, invoice_id, party_id, wholesale_customer_id, reference, shift_id, bdate, created_by, location, counter, counter_id, counter_name_snapshot, is_late_sale)
           VALUES (?, ?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId('pay'), tenantId, invoiceBranchId, method, method, amt, invoiceId, isWholesale ? null : (partyId || null), isWholesale ? (wholesaleCustomerRow?.id || wholesaleCustomerId || null) : null, p.reference || null, isLateSale ? null : (activeShift?.id || null), invoiceBdate, ctx.user!.id, location, resolvedCounterCode, resolvedCounterId, resolvedCounterName, isLateSale],
        );

        if (!isLateSale && activeShift?.id && resolvedCounterId && (activeShift.counterId !== resolvedCounterId || activeShift.counter_id !== resolvedCounterId)) {
          await q.exec(
            'UPDATE shifts SET counter_id = ?, counter = ?, counter_name_snapshot = ?, updated_at = now() WHERE id = ?',
            [resolvedCounterId, resolvedCounterCode, resolvedCounterName, activeShift.id],
          );
        }

        if (method === 'card' && p.reference) {
          const rrnMatch = p.reference.match(/RRN:([^\s|]+)/i);
          if (rrnMatch && rrnMatch[1]) {
            await q.exec(
              `UPDATE terminal_transactions
               SET invoice_id = ?
               WHERE tenant_id = ? AND (provider_ref_no = ? OR provider_tx_id = ?) AND invoice_id IS NULL`,
              [invoiceId, tenantId, rrnMatch[1], rrnMatch[1]],
            );
          }
        }
      }

      // 6. Customer loyalty points calculation & update based on shop's custom rule
      if (partyId) {
        const isLoyaltyActive = Boolean(shop.loyaltyEnabled ?? shop.loyalty_enabled ?? true);
        const ptsPer100 = Number(shop.loyaltyPointsPer100 ?? shop.loyalty_points_per_100 ?? 10);
        const minRedeem = Number(shop.loyaltyMinPointsRedeem ?? shop.loyalty_min_points_redeem ?? 10);

        if (isLoyaltyActive && ptsPer100 > 0) {
          // calculated.totalMinor is in paise (₹100 = 10,000 paise)
          earnedLoyaltyPoints = Math.floor((calculated.totalMinor * ptsPer100) / 10000);
        } else {
          earnedLoyaltyPoints = 0;
        }

        if (redeemedPoints > 0) {
          if (!isLoyaltyActive) {
            throw bad('Loyalty rewards program is currently disabled for this store.');
          }
          const custParty = await q.one<{ loyalty_points: number; loyaltyPoints: number }>(
            'SELECT loyalty_points FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
            [partyId, tenantId]
          );
          const currentPts = Number(custParty?.loyaltyPoints ?? custParty?.loyalty_points ?? 0);
          if (currentPts < minRedeem) {
            throw bad(`Minimum ${minRedeem} points required to redeem (customer has ${currentPts} points).`);
          }
          if (currentPts < redeemedPoints) {
            throw bad(`Insufficient loyalty points. Customer has ${currentPts} points, requested to redeem ${redeemedPoints}.`);
          }
        }

        const updatedCust = await q.one<{ loyalty_points?: number; loyaltyPoints?: number }>(
          `UPDATE parties
           SET loyalty_points = GREATEST(0, loyalty_points - ? + ?)
           WHERE id = ? AND tenant_id = ?
           RETURNING loyalty_points`,
          [redeemedPoints, earnedLoyaltyPoints, partyId, tenantId]
        );
        customerLoyaltyPoints = Number(updatedCust?.loyaltyPoints ?? updatedCust?.loyalty_points ?? 0);
      }

      // 6.5 Record post-closing adjustment record if this is a Late Sale
      if (isLateSale && closedDayRecord?.id) {
        await q.exec(
          `INSERT INTO day_closing_adjustments (
            id, tenant_id, day_closing_id, invoice_id, adjustment_type, amount_minor, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, 'late_sale', ?, ?, ?, now())`,
          [newId('dca'), tenantId, closedDayRecord.id, invoiceId, calculated.totalMinor, lateSaleReason, ctx.user!.id],
        );
      }

      // Invalidate cache
      invalidateTodayDashboardCache(tenantId);

      await audit(q, ctx, {
        action: isLateSale ? 'invoice.late_sale_create' : 'invoice.create',
        entity: 'invoice',
        entityId: invoiceId,
        detail: {
          number: assignedNumber,
          totalMinor: calculated.totalMinor,
          lines: formattedLines.length,
          earnedLoyaltyPoints,
          redeemedPoints,
          isLateSale,
          businessDate: invoiceBdate,
          lateSaleReason: isLateSale ? lateSaleReason : undefined,
          entryDateTime: isLateSale ? new Date().toISOString() : undefined,
          dayClosingId: closedDayRecord?.id,
        },
      });
    });

    // 7. Automatic SMS Notification to customer (isolated so billing / payment is never impacted)
    let smsDispatchResult: any = null;
    const billPhone = customerPhone || cleanPhoneDigits;
    if (billPhone && billPhone.trim()) {
      try {
        const branchRow = await ctx.db.one<any>(
          'SELECT name FROM branches WHERE id = ? AND tenant_id = ?',
          [invoiceBranchId, tenantId]
        );
        smsDispatchResult = await sendInvoiceBillSms(ctx.db, {
          tenantId,
          branchId: invoiceBranchId,
          customerId: partyId || null,
          invoiceId,
          invoiceNumber: assignedNumber,
          customerName: customerName || null,
          customerPhone: billPhone.trim(),
          totalMinor: calculated.totalMinor,
          earnedLoyaltyPoints,
          shopName: shop.name || 'Store',
          branchName: branchRow?.name || undefined,
        });
      } catch (smsErr: any) {
        console.warn(`[SMS Dispatch] Non-fatal error sending invoice SMS for ${assignedNumber}:`, smsErr?.message || smsErr);
      }
    }

    return {
      id: invoiceId,
      invoiceId,
      number: assignedNumber,
      invoiceType: isWholesale ? 'wholesale' : 'retail',
      totalMinor: calculated.totalMinor,
      paidMinor: totalPaidMinor,
      balanceMinor: Math.max(0, calculated.totalMinor - totalPaidMinor),
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      customerGstin: customerGstin || null,
      partyId,
      invoice: {
        id: invoiceId,
        invoiceId,
        number: assignedNumber,
        totalMinor: calculated.totalMinor,
        invoiceType: isWholesale ? 'wholesale' : 'retail',
        shareToken,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        customerGstin: customerGstin || null,
        partyId,
      },
      location,
      counter: resolvedCounterCode,
      counterId: resolvedCounterId,
      shareToken,
      tender: tenderData,
      earnedLoyaltyPoints,
      redeemedLoyaltyPoints: redeemedPoints,
      customerLoyaltyPoints,
      isNewCustomer,
      sms: smsDispatchResult ? {
        sent: smsDispatchResult.status === 'sent',
        status: smsDispatchResult.status,
        error: smsDispatchResult.error,
        skipped: Boolean(smsDispatchResult.skipped),
        messageId: smsDispatchResult.messageId,
      } : null,
    };
  });

  // Helper: Load full invoice details and construct PrintableBill structure
  async function loadPrintableInvoice(db: any, invoiceId: string, queryPaper?: string) {
    const inv = await db.one('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    if (!inv) throw notFound('Invoice');

    const shop = await db.one('SELECT * FROM tenants WHERE id = ?', [inv.tenantId ?? inv.tenant_id]);
    if (!shop) throw notFound('Shop');

    const lines = await db.query(
      `SELECT il.*, it.custom AS item_custom
       FROM invoice_lines il
       LEFT JOIN items it ON it.id = il.item_id
       WHERE il.invoice_id = ?
       ORDER BY il.pos ASC`,
      [inv.id],
    );
    const payments = await db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    const rawType = inv.invoiceType ?? inv.invoice_type;
    const isWholesale = rawType === 'wholesale';

    const custName = inv.customerName ?? inv.customer_name;
    const custPhone = inv.customerPhone ?? inv.customer_phone;
    const createdAt = inv.createdAt ?? inv.created_at;
    const customObj = typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {});
    const tender = customObj?.tender || null;
    const isLate = Boolean(inv.is_late_sale || inv.isLateSale);

    const profileSnapshot = typeof inv.profileSnapshot === 'string'
      ? JSON.parse(inv.profileSnapshot)
      : (inv.profileSnapshot ?? (typeof inv.profile_snapshot === 'string' ? JSON.parse(inv.profile_snapshot) : (inv.profile_snapshot || null)));
    const shopProfiles = typeof shop.invoiceProfiles === 'string'
      ? JSON.parse(shop.invoiceProfiles)
      : (shop.invoiceProfiles ?? (typeof shop.invoice_profiles === 'string' ? JSON.parse(shop.invoice_profiles) : (shop.invoice_profiles || null)));
    const wholesaleProfile = (isWholesale && profileSnapshot) ? profileSnapshot : (shopProfiles?.wholesale || {});
    const retailProfile = (!isWholesale && profileSnapshot) ? profileSnapshot : (shopProfiles?.retail || {});
    const activeProfile = isWholesale ? wholesaleProfile : retailProfile;
    const paper = isWholesale
      ? 'wholesale_a4'
      : ((queryPaper === 'thermal58' || retailProfile?.paper === 'thermal58') ? 'thermal58' : 'thermal80');

    const customFields: { label: string; value: string }[] = [];
    const pId = inv.partyId ?? inv.party_id;
    let partyRow: any = null;
    if (pId) {
      partyRow = await db.one(
        'SELECT name, phone, email, loyalty_points, gstin, address, state_code, custom FROM parties WHERE id = ?',
        [pId]
      );
      const pts = Number(partyRow?.loyaltyPoints ?? partyRow?.loyalty_points ?? 0);
      if (pts > 0) {
        customFields.push({ label: '⭐ Loyalty Balance', value: `${pts} pts` });
      }
    }
    const wcId = inv.wholesaleCustomerId ?? inv.wholesale_customer_id;
    let wholesaleCustomerRow: any = null;
    if (wcId) {
      wholesaleCustomerRow = await db.one(
        'SELECT name, company_name, phone, email, gstin, state_code, billing_address, shipping_address, contact_person, custom FROM wholesale_customers WHERE id = ?',
        [wcId]
      );
    }
    const invCounter = inv.counter || customObj?.counter;
    if (invCounter) {
      customFields.push({ label: 'Counter', value: String(invCounter) });
    }

    if (isLate) {
      customFields.push({ label: 'Type', value: 'LATE SALE (Post-Day-Close)' });
      const entryTimeFormatted = new Date(inv.created_at || inv.createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'short',
        timeStyle: 'short',
      });
      customFields.push({ label: 'Entered On', value: entryTimeFormatted });
      if (inv.late_sale_reason || inv.lateSaleReason) {
        customFields.push({ label: 'Reason', value: String(inv.late_sale_reason || inv.lateSaleReason) });
      }
    }

    const partyCustom = (partyRow?.custom && typeof partyRow.custom === 'object') ? partyRow.custom : {};
    const finalCustName = (wholesaleCustomerRow?.name || wholesaleCustomerRow?.company_name || custName || partyRow?.name || customObj?.customerName || '').trim();
    const finalCustPhone = (wholesaleCustomerRow?.phone || custPhone || partyRow?.phone || customObj?.customerPhone || '').trim();
    const finalCustGstin = (wholesaleCustomerRow?.gstin || inv.customerGstin || inv.customer_gstin || partyRow?.gstin || customObj?.customerGstin || '').trim().toUpperCase();
    const finalCustAddress = (wholesaleCustomerRow?.billing_address || customObj?.billingAddress || partyRow?.address || '').trim();
    const finalCustShipping = (wholesaleCustomerRow?.shipping_address || customObj?.shippingAddress || finalCustAddress).trim();
    const finalContactPerson = (wholesaleCustomerRow?.contact_person || customObj?.contactPerson || partyCustom?.contactPerson || '').trim();
    const finalStateCode = (customObj?.customerStateCode || partyRow?.state_code || partyRow?.stateCode || (finalCustGstin ? finalCustGstin.slice(0, 2) : '') || inv.place_state || inv.placeState || '').trim();
    const finalStateName = (customObj?.customerState || (finalStateCode ? stateName(finalStateCode) : '') || '').trim();

    const wholesaleDisplayName = (
      wholesaleProfile?.displayName ||
      shop.wholesaleBusinessName ||
      shop.wholesale_business_name ||
      ''
    ).trim();
    const wholesaleLegalName = (wholesaleProfile?.legalName || '').trim();

    const wholesaleMeta = isWholesale ? {
      invoiceType: 'wholesale' as const,
      displayName: wholesaleDisplayName || wholesaleLegalName || shop.wholesaleBusinessName || shop.wholesale_business_name || shop.name,
      legalName: wholesaleLegalName || null,
      logoUrl: wholesaleProfile?.logoUrl || null,
      phone: wholesaleProfile?.phone || shop.phone || null,
      email: wholesaleProfile?.email || null,
      gstin: wholesaleProfile?.gstin || shop.gstin || null,
      address: wholesaleProfile?.address || shop.address || null,
      paymentTerms: customObj?.paymentTerms || 'Due on Receipt',
      billingAddress: finalCustAddress || null,
      shippingAddress: finalCustShipping || null,
      contactPerson: finalContactPerson || null,
      customerState: finalStateName || null,
      customerStateCode: finalStateCode || null,
      terms: wholesaleProfile?.terms || null,
      jurisdiction: wholesaleProfile?.jurisdiction || null,
    } : null;

    const printable: PrintableBill = {
      number: inv.number,
      kind: 'sale',
      invoiceType: isWholesale ? 'wholesale' : 'retail',
      dateText: isLate
        ? `${inv.bdate} (Business Date)`
        : new Date(createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      shop: {
        name: isWholesale
          ? (wholesaleDisplayName || wholesaleLegalName || shop.wholesaleBusinessName || shop.wholesale_business_name || shop.name)
          : (retailProfile?.displayName || shop.name),
        address: isWholesale ? (wholesaleProfile?.address || shop.address) : (retailProfile?.address || shop.address),
        phone: isWholesale ? (wholesaleProfile?.phone || shop.phone) : (retailProfile?.phone || shop.phone),
        gstin: isWholesale ? (wholesaleProfile?.gstin || shop.gstin) : (retailProfile?.gstin || shop.gstin),
        upiId: shop.upiId ?? shop.upi_id,
        logoUrl: activeProfile?.logoUrl || shop.logoUrl || shop.logo_url || null,
      },
      customer: finalCustName ? {
        name: finalCustName,
        phone: finalCustPhone || null,
        gstin: finalCustGstin || null,
        address: finalCustAddress || null,
        shippingAddress: finalCustShipping || null,
        contactPerson: finalContactPerson || null,
        stateCode: finalStateCode || null,
        stateName: finalStateName || null,
      } : null,
      lines: lines.map((l: any) => {
        let mrpMinor = 0;
        try {
          const itemCustom = typeof l.itemCustom === 'string' ? JSON.parse(l.itemCustom) : (l.itemCustom || {});
          if (typeof itemCustom.mrpMinor === 'number' && itemCustom.mrpMinor > 0) {
            mrpMinor = itemCustom.mrpMinor;
          } else if (typeof itemCustom.mrp_minor === 'number' && itemCustom.mrp_minor > 0) {
            mrpMinor = itemCustom.mrp_minor;
          }
        } catch { }

        const priceMinor = Number(l.priceMinor ?? l.price_minor);
        const discountMinor = Number(l.discountMinor ?? l.discount_minor);
        const qtyMilli = Number(l.qtyMilli ?? l.qty_milli);
        const discountPerUnit = qtyMilli > 0 ? Math.round((discountMinor * 1000) / qtyMilli) : 0;
        if (!mrpMinor || mrpMinor <= priceMinor) {
          if (discountPerUnit > 0) {
            mrpMinor = priceMinor + discountPerUnit;
          } else {
            mrpMinor = Math.max(priceMinor, Math.ceil((priceMinor * 1.15) / 100) * 100);
          }
        }

        return {
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qtyMilli,
          priceMinor,
          mrpMinor,
          discountMinor,
          taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp),
          taxableMinor: Number(l.taxableMinor ?? l.taxable_minor),
          cgstMinor: Number(l.cgstMinor ?? l.cgst_minor),
          sgstMinor: Number(l.sgstMinor ?? l.sgst_minor),
          igstMinor: Number(l.igstMinor ?? l.igst_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
        };
      }),
      totals: {
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        discountMinor: Number(inv.discountMinor ?? inv.discount_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        igstMinor: Number(inv.igstMinor ?? inv.igst_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
      },
      payments: payments.map((p: any) => ({ method: p.method, amountMinor: Number(p.amountMinor ?? p.amount_minor) })),
      tender,
      customFields,
      intra: Boolean(inv.intra !== false),
      wholesale: wholesaleMeta,
    };

    return { printable, isWholesale, paper, shop, inv };
  }

  // Print Bill (HTML Thermal / A4 receipt) or Download PDF if requested via format=pdf / download=true
  r.get('/api/invoices/:id/print', async (ctx) => {
    const { printable, isWholesale, paper, shop, inv } = await loadPrintableInvoice(ctx.db, ctx.params.id, ctx.query.paper);

    // Support direct PDF download mode via query parameter
    if (ctx.query.format === 'pdf' || ctx.query.download === 'true') {
      const pdfBuffer = await generateInvoicePdf(printable);
      const safeNumber = (printable.number || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = isWholesale ? `Wholesale_Invoice_${safeNumber}.pdf` : `Invoice_${safeNumber}.pdf`;
      return new FileResponse(pdfBuffer, 'application/pdf', filename);
    }

    const autoPrint = ctx.query.autoprint === 'true';
    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId) {
      const upi = upiUri({ vpa: upiId, name: shop.name, amountMinor: printable.totals.totalMinor, note: `Bill ${inv.number}` });
      qrSvgMarkup = qrSvg(upi, { size: 120 });
    }

    const html = renderBillDoc(printable, { ...DEFAULT_CONFIG.template, paper: paper as any }, { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay', autoPrint });
    return new HtmlResponse(html);
  });

  // Dedicated Invoice PDF Download Endpoint (Authenticated via requireUser)
  r.get('/api/invoices/:id/download-pdf', requireUser, async (ctx) => {
    const { printable, isWholesale } = await loadPrintableInvoice(ctx.db, ctx.params.id, ctx.query.paper);
    const pdfBuffer = await generateInvoicePdf(printable);
    const safeNumber = (printable.number || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = isWholesale ? `Wholesale_Invoice_${safeNumber}.pdf` : `Invoice_${safeNumber}.pdf`;
    return new FileResponse(pdfBuffer, 'application/pdf', filename);
  });

  // Track WhatsApp bill share
  r.post('/api/invoices/:id/whatsapp-track', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!inv) throw notFound('Invoice');

    const b = ctx.body ?? {};
    const rawPhone = V.str(b.phone, 'Customer phone', { required: true, max: 30 });
    const normalized = normalizePhone(rawPhone);
    if (!normalized) throw bad('Invalid phone number. Must be a valid 10-digit mobile number.');

    const lang = V.oneOf(b.language ?? 'en', 'Language', ['en', 'hi', 'ta'] as const, 'en');
    const saveToCustomer = Boolean(b.saveToCustomer);
    const now = new Date().toISOString();
    const sentBy = ctx.user?.id || null;
    const newCount = Number(inv.whatsapp_send_count ?? inv.whatsappSendCount ?? 0) + 1;

    await ctx.db.exec(
      `UPDATE invoices SET
         whatsapp_send_count = COALESCE(whatsapp_send_count, 0) + 1,
         whatsapp_last_sent_at = ?,
         whatsapp_last_sent_to = ?,
         whatsapp_last_language = ?,
         whatsapp_last_sent_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [now, normalized, lang, sentBy, inv.id, tenantId]
    );

    // If requested and invoice is linked to a customer party, save/update phone on customer master
    const partyId = inv.partyId ?? inv.party_id;
    if (saveToCustomer && partyId) {
      await ctx.db.exec(
        `UPDATE parties SET phone = ? WHERE id = ? AND tenant_id = ?`,
        [normalized, partyId, tenantId]
      );
      await ctx.db.exec(
        `UPDATE invoices SET customer_phone = ? WHERE id = ? AND tenant_id = ?`,
        [normalized, inv.id, tenantId]
      );
    }

    await audit(ctx.db, ctx, {
      action: 'invoice.whatsapp_share',
      entity: 'invoice',
      entityId: inv.id,
      detail: {
        number: inv.number,
        phone: normalized,
        language: lang,
        sendCount: newCount,
        saveToCustomer,
      },
    });

    return {
      success: true,
      sendCount: newCount,
      lastSentAt: now,
      lastSentTo: normalized,
      lastLanguage: lang,
    };
  });

  // Public Hosted Bill Link (/b/:token)
  r.get('/b/:token', async (ctx) => {
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE share_token = ?', [ctx.params.token]);
    if (!inv) throw notFound('Bill not found or link has expired.');

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [inv.tenantId ?? inv.tenant_id]);
    if (!shop) throw notFound('Shop');

    const lines = await ctx.db.query(
      `SELECT il.*, it.custom AS item_custom
       FROM invoice_lines il
       LEFT JOIN items it ON it.id = il.item_id
       WHERE il.invoice_id = ?
       ORDER BY il.pos ASC`,
      [inv.id],
    );
    const payments = await ctx.db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    const custName = inv.customerName ?? inv.customer_name;
    const custPhone = inv.customerPhone ?? inv.customer_phone;
    const createdAt = inv.createdAt ?? inv.created_at;
    const customObj = typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {});
    const tender = customObj?.tender || null;
    const isLate = Boolean(inv.is_late_sale || inv.isLateSale);

    const pId = inv.partyId ?? inv.party_id;
    let partyRow: any = null;
    if (pId) {
      partyRow = await ctx.db.one(
        'SELECT name, phone, email, loyalty_points, gstin, address, state_code, custom FROM parties WHERE id = ?',
        [pId]
      );
    }
    const wcId = inv.wholesaleCustomerId ?? inv.wholesale_customer_id;
    let wholesaleCustomerRow: any = null;
    if (wcId) {
      wholesaleCustomerRow = await ctx.db.one(
        'SELECT name, company_name, phone, email, gstin, state_code, billing_address, shipping_address, contact_person, custom FROM wholesale_customers WHERE id = ?',
        [wcId]
      );
    }
    const partyCustom = (partyRow?.custom && typeof partyRow.custom === 'object') ? partyRow.custom : {};
    const finalCustName = (wholesaleCustomerRow?.name || wholesaleCustomerRow?.company_name || custName || partyRow?.name || customObj?.customerName || '').trim();
    const finalCustPhone = (wholesaleCustomerRow?.phone || custPhone || partyRow?.phone || customObj?.customerPhone || '').trim();
    const finalCustGstin = (wholesaleCustomerRow?.gstin || inv.customerGstin || inv.customer_gstin || partyRow?.gstin || customObj?.customerGstin || '').trim().toUpperCase();
    const finalCustAddress = (wholesaleCustomerRow?.billing_address || customObj?.billingAddress || partyRow?.address || '').trim();
    const finalCustShipping = (wholesaleCustomerRow?.shipping_address || customObj?.shippingAddress || finalCustAddress).trim();
    const finalContactPerson = (wholesaleCustomerRow?.contact_person || customObj?.contactPerson || partyCustom?.contactPerson || '').trim();
    const finalStateCode = (customObj?.customerStateCode || partyRow?.state_code || partyRow?.stateCode || (finalCustGstin ? finalCustGstin.slice(0, 2) : '') || inv.place_state || inv.placeState || '').trim();
    const finalStateName = (customObj?.customerState || (finalStateCode ? stateName(finalStateCode) : '') || '').trim();

    const isWholesale = (inv.invoice_type === 'wholesale' || inv.invoiceType === 'wholesale');
    const rawShopProfiles = shop.invoiceProfiles ?? shop.invoice_profiles;
    const shopProfiles = typeof rawShopProfiles === 'string' ? JSON.parse(rawShopProfiles) : (rawShopProfiles || null);
    const wholesaleProfile = shopProfiles?.wholesale;
    const retailProfile = shopProfiles?.retail;
    const wholesaleDisplayName = (
      wholesaleProfile?.displayName ||
      shop.wholesaleBusinessName ||
      shop.wholesale_business_name ||
      ''
    ).trim();
    const wholesaleLegalName = (wholesaleProfile?.legalName || '').trim();

    const wholesaleMeta = isWholesale ? {
      invoiceType: 'wholesale' as const,
      displayName: wholesaleDisplayName || wholesaleLegalName || shop.wholesaleBusinessName || shop.wholesale_business_name || shop.name,
      legalName: wholesaleLegalName || null,
      logoUrl: wholesaleProfile?.logoUrl || null,
      phone: wholesaleProfile?.phone || shop.phone || null,
      email: wholesaleProfile?.email || null,
      gstin: wholesaleProfile?.gstin || shop.gstin || null,
      address: wholesaleProfile?.address || shop.address || null,
      paymentTerms: customObj?.paymentTerms || 'Due on Receipt',
      billingAddress: finalCustAddress || null,
      shippingAddress: finalCustShipping || null,
      contactPerson: finalContactPerson || null,
      customerState: finalStateName || null,
      customerStateCode: finalStateCode || null,
      terms: wholesaleProfile?.terms || null,
      jurisdiction: wholesaleProfile?.jurisdiction || null,
    } : null;

    const printable: PrintableBill = {
      number: inv.number,
      kind: 'sale',
      invoiceType: isWholesale ? 'wholesale' : 'retail',
      dateText: isLate
        ? `${inv.bdate} (Business Date)`
        : new Date(createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      shop: {
        name: isWholesale
          ? (wholesaleDisplayName || wholesaleLegalName || shop.wholesaleBusinessName || shop.wholesale_business_name || shop.name)
          : shop.name,
        address: isWholesale ? (wholesaleProfile?.address || shop.address) : shop.address,
        phone: isWholesale ? (wholesaleProfile?.phone || shop.phone) : shop.phone,
        gstin: isWholesale ? (wholesaleProfile?.gstin || shop.gstin) : shop.gstin,
        upiId: shop.upiId ?? shop.upi_id,
        logoUrl: shop.logoUrl ?? shop.logo_url ?? null,
      },
      customer: finalCustName ? {
        name: finalCustName,
        phone: finalCustPhone || null,
        gstin: finalCustGstin || null,
        address: finalCustAddress || null,
        shippingAddress: finalCustShipping || null,
        contactPerson: finalContactPerson || null,
        stateCode: finalStateCode || null,
        stateName: finalStateName || null,
      } : null,
      lines: lines.map((l: any) => {
        let mrpMinor = 0;
        try {
          const itemCustom = typeof l.itemCustom === 'string' ? JSON.parse(l.itemCustom) : (l.itemCustom || {});
          if (typeof itemCustom.mrpMinor === 'number' && itemCustom.mrpMinor > 0) {
            mrpMinor = itemCustom.mrpMinor;
          } else if (typeof itemCustom.mrp_minor === 'number' && itemCustom.mrp_minor > 0) {
            mrpMinor = itemCustom.mrp_minor;
          }
        } catch { }

        const priceMinor = Number(l.priceMinor ?? l.price_minor);
        const discountMinor = Number(l.discountMinor ?? l.discount_minor);
        const qtyMilli = Number(l.qtyMilli ?? l.qty_milli);
        const discountPerUnit = qtyMilli > 0 ? Math.round((discountMinor * 1000) / qtyMilli) : 0;
        if (!mrpMinor || mrpMinor <= priceMinor) {
          if (discountPerUnit > 0) {
            mrpMinor = priceMinor + discountPerUnit;
          } else {
            mrpMinor = Math.max(priceMinor, Math.ceil((priceMinor * 1.15) / 100) * 100);
          }
        }

        return {
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qtyMilli,
          priceMinor,
          mrpMinor,
          discountMinor,
          taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp),
          taxableMinor: Number(l.taxableMinor ?? l.taxable_minor),
          cgstMinor: Number(l.cgstMinor ?? l.cgst_minor),
          sgstMinor: Number(l.sgstMinor ?? l.sgst_minor),
          igstMinor: Number(l.igstMinor ?? l.igst_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
        };
      }),
      totals: {
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        discountMinor: Number(inv.discountMinor ?? inv.discount_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        igstMinor: Number(inv.igstMinor ?? inv.igst_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
      },
      payments: payments.map((p: any) => ({ method: p.method, amountMinor: Number(p.amountMinor ?? p.amount_minor) })),
      tender,
      customFields: [],
      intra: Boolean(inv.intra !== false),
      wholesale: wholesaleMeta,
    };

    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId && printable.totals.balanceMinor > 0) {
      const upi = upiUri({ vpa: upiId, name: shop.name, amountMinor: printable.totals.balanceMinor, note: `Bill ${inv.number}` });
      qrSvgMarkup = qrSvg(upi, { size: 120 });
    }

    const paper = isWholesale ? 'wholesale_a4' : ((retailProfile?.paper === 'thermal58') ? 'thermal58' : 'thermal80');
    const html = renderBillDoc(printable, { ...DEFAULT_CONFIG.template, paper }, { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay balance', autoPrint: false });
    return new HtmlResponse(html);
  });
}
