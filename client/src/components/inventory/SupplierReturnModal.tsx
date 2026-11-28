import React, { useState, useEffect } from 'react';
import type { Party, DamagedStockItem } from '../../api.ts';
import { createSupplierReturn } from '../../api.ts';

interface SupplierReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: Party[];
  availableDamagedStock: DamagedStockItem[];
  preselectedDamagedItem?: DamagedStockItem | null;
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

export const SupplierReturnModal: React.FC<SupplierReturnModalProps> = ({
  isOpen,
  onClose,
  suppliers,
  availableDamagedStock,
  preselectedDamagedItem,
  onSuccess,
  showToast,
}) => {
  const [supplierId, setSupplierId] = useState<string>(
    preselectedDamagedItem?.supplierId || preselectedDamagedItem?.supplier_id || ''
  );
  const [returnType, setReturnType] = useState<'REPLACEMENT' | 'REFUND' | 'CREDIT_NOTE' | 'SCRAP'>('REPLACEMENT');
  const [selectedDamageId, setSelectedDamageId] = useState<string>(
    preselectedDamagedItem?.id || ''
  );
  const [qty, setQty] = useState<string>(
    preselectedDamagedItem
      ? String(((preselectedDamagedItem.qtyMilli ?? preselectedDamagedItem.qty_milli ?? 1000) / 1000))
      : '1'
  );
  const [returnReason, setReturnReason] = useState<string>(
    preselectedDamagedItem?.damageReason || preselectedDamagedItem?.damage_reason || 'Defective textile goods'
  );
  const [returnDate, setReturnDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    if (preselectedDamagedItem) {
      setSelectedDamageId(preselectedDamagedItem.id);
      const suppId =
        preselectedDamagedItem.supplierId ||
        preselectedDamagedItem.supplier_id ||
        (suppliers.length === 1 ? suppliers[0].id : '');
      setSupplierId(suppId);
      const q = ((preselectedDamagedItem.qtyMilli ?? preselectedDamagedItem.qty_milli ?? 1000) / 1000);
      setQty(String(q));
      setReturnReason(
        preselectedDamagedItem.damageReason ||
        preselectedDamagedItem.damage_reason ||
        'Defective textile goods'
      );
    } else {
      setSelectedDamageId('');
      setSupplierId(suppliers.length === 1 ? suppliers[0].id : '');
      setQty('1');
      setReturnReason('Defective textile goods');
    }
    setNotes('');
    setReturnType('REPLACEMENT');
  }, [isOpen, preselectedDamagedItem, suppliers]);

  if (!isOpen) return null;

  // Eligible damaged items for return: status DAMAGED or DEFECTIVE
  const eligibleItems = availableDamagedStock.filter(
    (ds) => ds.status === 'DAMAGED' || ds.status === 'DEFECTIVE'
  );

  const selectedDmg = eligibleItems.find((i) => i.id === selectedDamageId) || preselectedDamagedItem;

  const handleSelectDamageItem = (id: string) => {
    setSelectedDamageId(id);
    const found = eligibleItems.find((i) => i.id === id);
    if (found) {
      setQty(String(((found.qtyMilli ?? found.qty_milli ?? 1000) / 1000)));
      setReturnReason(found.damageReason || found.damage_reason || '');
      const suppId = found.supplierId || found.supplier_id;
      if (suppId && !supplierId) {
        setSupplierId(suppId);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      showToast('Please select a supplier.');
      return;
    }
    if (!selectedDmg) {
      showToast('Please select a damaged/defective product to return.');
      return;
    }

    const returnQtyUnits = parseFloat(qty);
    if (isNaN(returnQtyUnits) || returnQtyUnits <= 0) {
      showToast('Please enter a valid return quantity.');
      return;
    }

    const maxEligible = ((selectedDmg.qtyMilli ?? selectedDmg.qty_milli ?? 0) / 1000);
    if (returnQtyUnits > maxEligible) {
      showToast(`Return quantity (${returnQtyUnits}) cannot exceed recorded damaged quantity (${maxEligible}).`);
      return;
    }

    const targetItemId = selectedDmg.itemId || selectedDmg.item_id;
    if (!targetItemId) {
      showToast('Could not identify the item ID for this return.');
      return;
    }

    try {
      setSubmitting(true);
      await createSupplierReturn({
        supplierId,
        purchaseId: selectedDmg.purchaseId || selectedDmg.purchase_id,
        returnType,
        returnDate,
        notes: notes || undefined,
        lines: [
          {
            damagedStockId: selectedDmg.id,
            itemId: targetItemId,
            qty: returnQtyUnits,
            unit: selectedDmg.unit || 'pcs',
            rollNo: selectedDmg.rollNo || selectedDmg.roll_no,
            batchNo: selectedDmg.batchNo || selectedDmg.batch_no,
            size: selectedDmg.size,
            colour: selectedDmg.colour,
            design: selectedDmg.design,
            fabricType: selectedDmg.fabricType || selectedDmg.fabric_type,
            returnReason: returnReason || selectedDmg.damageReason || selectedDmg.damage_reason || 'Defective textile goods',
            notes: notes || undefined,
          },
        ],
      });

      showToast(`Supplier return order created successfully.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to create supplier return.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
              Create Supplier Return
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
              Send damaged/defective textile goods back to the vendor for replacement or credit
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9ca3af' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {/* Supplier Selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Target Supplier *
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            >
              <option value="">-- Choose Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Damaged Stock Item Selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Select Damaged / Defective Stock Item *
            </label>
            <select
              value={selectedDamageId}
              onChange={(e) => handleSelectDamageItem(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            >
              <option value="">-- Choose from recorded damaged stock --</option>
              {eligibleItems.map((ds) => {
                const dmgNum = ds.damageNumber || ds.damage_number || ds.id;
                const name = ds.itemName || ds.item_name || 'Item';
                const qUnits = (((ds.qtyMilli ?? ds.qty_milli ?? 0) / 1000)).toFixed(1);
                const reason = ds.damageReason || ds.damage_reason || '';
                return (
                  <option key={ds.id} value={ds.id}>
                    [{dmgNum}] {name} — {qUnits} {ds.unit} {reason ? `(${reason})` : ''}
                  </option>
                );
              })}
            </select>
            {selectedDmg && (
              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  backgroundColor: '#f9fafb',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  fontSize: '0.8rem',
                  color: '#4b5563',
                }}
              >
                <div><strong>Product:</strong> {selectedDmg.itemName || selectedDmg.item_name}</div>
                {(selectedDmg.damageDate || selectedDmg.damage_date) && (
                  <div><strong>Customer Return Date:</strong> {new Date(String(selectedDmg.damageDate || selectedDmg.damage_date)).toLocaleDateString('en-IN')}</div>
                )}
                <div><strong>Recorded Defect:</strong> {selectedDmg.damageReason || selectedDmg.damage_reason}</div>
                {(selectedDmg.rollNo || selectedDmg.roll_no) && <div><strong>Roll No:</strong> {selectedDmg.rollNo || selectedDmg.roll_no}</div>}
                {selectedDmg.size && <div><strong>Size / Shade:</strong> {selectedDmg.size} / {selectedDmg.colour || 'N/A'}</div>}
                <div><strong>Eligible Damaged Qty:</strong> {(((selectedDmg.qtyMilli ?? selectedDmg.qty_milli ?? 0) / 1000)).toFixed(2)} {selectedDmg.unit}</div>
              </div>
            )}
          </div>

          {/* Return Quantity, Shop Return Date & Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Return Qty ({selectedDmg?.unit || 'pcs'}) *
              </label>
              <input
                type="number"
                step="any"
                min="0.001"
                required
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Shop Return Date *
              </label>
              <input
                type="date"
                required
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Expected Resolution Type *
              </label>
              <select
                value={returnType}
                onChange={(e) => setReturnType(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              >
                <option value="REPLACEMENT">Replacement of Goods (Default)</option>
                <option value="REFUND">Vendor Refund</option>
                <option value="CREDIT_NOTE">Supplier Credit Note</option>
                <option value="SCRAP">Vendor Authorized Scrap</option>
              </select>
            </div>
          </div>

          {/* Return Reason */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Return Reason / Instructions to Supplier
            </label>
            <input
              type="text"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="e.g. Weaving defect and colour fading in middle fold"
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Internal Remarks
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Handing over to supplier sales representative on next delivery."
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: '#fff',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '0.5rem 1.25rem',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: '#2563eb',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Creating...' : 'Create Supplier Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
