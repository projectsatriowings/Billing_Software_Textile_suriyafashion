import React, { useState } from 'react';
import type { Item, SupplierReturn, SupplierReturnLine } from '../../api.ts';
import { createSupplierReplacement } from '../../api.ts';

interface SupplierReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplierReturn: SupplierReturn;
  items: Item[];
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

export const SupplierReplacementModal: React.FC<SupplierReplacementModalProps> = ({
  isOpen,
  onClose,
  supplierReturn,
  items,
  onSuccess,
  showToast,
}) => {
  const lines = supplierReturn.lines || [];
  const [selectedLineId, setSelectedLineId] = useState<string>(lines[0]?.id || '');
  const [replacementItemId, setReplacementItemId] = useState<string>(lines[0]?.item_id || '');
  const [condition, setCondition] = useState<'GOOD' | 'DAMAGED' | 'DEFECTIVE' | 'SHORT_RECEIVED' | 'WRONG_PRODUCT'>('GOOD');
  const [challanNo, setChallanNo] = useState<string>('');
  const [receivedDate, setReceivedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rollNo, setRollNo] = useState<string>('');
  const [batchNo, setBatchNo] = useState<string>('');
  const [size, setSize] = useState<string>('');
  const [colour, setColour] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const selectedLine = lines.find((l) => l.id === selectedLineId) || lines[0];
  const pendingUnits = selectedLine ? (selectedLine.pendingQtyMilli ?? selectedLine.pending_qty_milli ?? 0) / 1000 : 0;
  const [qty, setQty] = useState<string>(pendingUnits > 0 ? String(pendingUnits) : '1');

  if (!isOpen) return null;

  const handleLineChange = (lineId: string) => {
    setSelectedLineId(lineId);
    const line = lines.find((l) => l.id === lineId);
    if (line) {
      setReplacementItemId(line.itemId || line.item_id || '');
      setQty(String(((line.pendingQtyMilli ?? line.pending_qty_milli ?? 0) / 1000)));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLine) {
      showToast('No return line selected.');
      return;
    }

    const receivedQtyUnits = parseFloat(qty);
    if (isNaN(receivedQtyUnits) || receivedQtyUnits <= 0) {
      showToast('Please enter a valid received quantity.');
      return;
    }

    if (receivedQtyUnits > pendingUnits) {
      showToast(`Received quantity (${receivedQtyUnits}) cannot exceed pending quantity (${pendingUnits}).`);
      return;
    }

    const repItemId = replacementItemId || selectedLine.itemId || selectedLine.item_id;
    if (!repItemId) {
      showToast('Please select or specify a replacement item.');
      return;
    }

    try {
      setSubmitting(true);
      await createSupplierReplacement({
        returnId: supplierReturn.id,
        returnLineId: selectedLine.id,
        replacementItemId: repItemId,
        qty: receivedQtyUnits,
        unit: selectedLine.unit || 'pcs',
        condition,
        challanNo: challanNo || undefined,
        receivedDate,
        rollNo: rollNo || undefined,
        batchNo: batchNo || undefined,
        size: size || undefined,
        colour: colour || undefined,
        notes: notes || undefined,
      });

      if (condition === 'GOOD') {
        showToast(
          `Received ${receivedQtyUnits} ${selectedLine.unit || 'pcs'} replacement in good condition. Stock updated!`
        );
      } else {
        showToast(
          `Recorded ${receivedQtyUnits} ${selectedLine.unit || 'pcs'} replacement as ${condition}. Kept in defective stock!`
        );
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to record supplier replacement.');
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
          maxWidth: '680px',
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
              Receive Supplier Replacement
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
              Against Return Reference: <strong style={{ color: '#2563eb' }}>{supplierReturn.return_number}</strong> ({supplierReturn.supplier_name || 'Vendor'})
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

        {/* Accounting Rule Callout */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            borderBottom: '1px solid #bbf7d0',
            padding: '0.75rem 1.5rem',
            fontSize: '0.8rem',
            color: '#166534',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>ℹ️</span>
          <span>
            <strong>Accounting Guarantee:</strong> Supplier replacement is NOT a fresh purchase. It restores stock without creating duplicate supplier payables or duplicate GST ITC.
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {/* Return Line selection */}
          {lines.length > 1 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Select Return Item Line *
              </label>
              <select
                value={selectedLineId}
                onChange={(e) => handleLineChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              >
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.item_name} (Pending: {(l.pending_qty_milli / 1000).toFixed(1)} {l.unit})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Line summary card */}
          {selectedLine && (
            <div
              style={{
                marginBottom: '1.25rem',
                padding: '0.75rem 1rem',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.5rem',
                fontSize: '0.825rem',
              }}
            >
              <div>
                <span style={{ color: '#64748b', display: 'block' }}>Original Product</span>
                <strong style={{ color: '#0f172a' }}>{selectedLine.itemName || selectedLine.item_name}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b', display: 'block' }}>Returned Quantity</span>
                <strong style={{ color: '#0f172a' }}>{(((selectedLine.qtyMilli ?? selectedLine.qty_milli ?? 0) / 1000)).toFixed(1)} {selectedLine.unit}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b', display: 'block' }}>Pending Replacement</span>
                <strong style={{ color: '#d97706' }}>{pendingUnits.toFixed(1)} {selectedLine.unit}</strong>
              </div>
            </div>
          )}

          {/* Condition Selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Received Goods Condition *
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${condition === 'GOOD' ? '#10b981' : '#e5e7eb'}`,
                  backgroundColor: condition === 'GOOD' ? '#ecfdf5' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="condition"
                  value="GOOD"
                  checked={condition === 'GOOD'}
                  onChange={() => setCondition('GOOD')}
                  style={{ marginRight: '0.5rem' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: condition === 'GOOD' ? '#047857' : '#374151' }}>
                    Good / Saleable Stock
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    Quality verified; immediately available for POS sales
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${condition === 'DEFECTIVE' ? '#f59e0b' : '#e5e7eb'}`,
                  backgroundColor: condition === 'DEFECTIVE' ? '#fffbeb' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="condition"
                  value="DEFECTIVE"
                  checked={condition === 'DEFECTIVE'}
                  onChange={() => setCondition('DEFECTIVE')}
                  style={{ marginRight: '0.5rem' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: condition === 'DEFECTIVE' ? '#b45309' : '#374151' }}>
                    Defective on Arrival
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    Do not add to stock; keep in defective stock
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Received Quantity & Challan No */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Received Qty ({selectedLine?.unit || 'pcs'}) *
              </label>
              <input
                type="number"
                step="any"
                min="0.001"
                max={pendingUnits}
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
              {parseFloat(qty) < pendingUnits && (
                <div style={{ fontSize: '0.75rem', color: '#d97706', marginTop: '0.25rem' }}>
                  Partial receipt: {(pendingUnits - parseFloat(qty)).toFixed(1)} {selectedLine?.unit} will remain pending.
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Supplier Delivery Challan / LR No *
              </label>
              <input
                type="text"
                placeholder="e.g. DC-78921 / LR-441"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
                required
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
          </div>

          {/* Textile replacement attributes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                New Roll No
              </label>
              <input
                type="text"
                placeholder="e.g. R-202"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                New Batch No
              </label>
              <input
                type="text"
                placeholder="e.g. B-991"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                Size
              </label>
              <input
                type="text"
                placeholder="e.g. M, 38"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                Colour
              </label>
              <input
                type="text"
                placeholder="e.g. Navy Blue"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Receipt Notes / Verification Remarks
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Checked by Store Manager; packaging and fabric intact."
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
                backgroundColor: '#059669',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Recording Receipt...' : 'Confirm Replacement Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
