import React, { useState } from 'react';
import type { Item, Party } from '../../api.ts';
import { createDamagedStock } from '../../api.ts';

interface DamagedStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  suppliers: Party[];
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

const DAMAGE_REASONS = [
  'Fabric Tear',
  'Colour Fading',
  'Colour Mismatch',
  'Stitching Defect',
  'Size Mismatch',
  'Printing Defect',
  'Weaving Defect',
  'Stain / Dirt',
  'Manufacturing Defect',
  'Water Damage',
  'Packaging Damage',
  'Missing Piece',
  'Other',
];

export const DamagedStockModal: React.FC<DamagedStockModalProps> = ({
  isOpen,
  onClose,
  items,
  suppliers,
  onSuccess,
  showToast,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [searchItem, setSearchItem] = useState<string>('');
  const [classification, setClassification] = useState<'DAMAGED' | 'DEFECTIVE'>('DAMAGED');
  const [qty, setQty] = useState<string>('1');
  const [damageReason, setDamageReason] = useState<string>('Fabric Tear');
  const [customReason, setCustomReason] = useState<string>('');
  const [rollNo, setRollNo] = useState<string>('');
  const [batchNo, setBatchNo] = useState<string>('');
  const [size, setSize] = useState<string>('');
  const [colour, setColour] = useState<string>('');
  const [design, setDesign] = useState<string>('');
  const [fabricType, setFabricType] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [damageDate, setDamageDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const selectedItem = items.find((i) => i.id === selectedItemId);

  const filteredItems = items
    .filter((i) => {
      if (!searchItem) return true;
      const term = searchItem.toLowerCase();
      return (
        i.name.toLowerCase().includes(term) ||
        (i.sku && i.sku.toLowerCase().includes(term)) ||
        (i.barcode && i.barcode.toLowerCase().includes(term))
      );
    })
    .slice(0, 30);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) {
      showToast('Please select a textile product.');
      return;
    }
    const parsedQty = parseFloat(qty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      showToast('Please enter a valid damaged quantity.');
      return;
    }

    try {
      setSubmitting(true);
      await createDamagedStock({
        itemId: selectedItemId,
        qty: parsedQty,
        classification,
        damageReason: damageReason === 'Other' && customReason ? customReason : damageReason,
        customReason: damageReason === 'Other' ? customReason : undefined,
        unit: selectedItem?.unit || 'pcs',
        rollNo: rollNo || undefined,
        batchNo: batchNo || undefined,
        size: size || (selectedItem as any)?.size || undefined,
        colour: colour || undefined,
        design: design || undefined,
        fabricType: fabricType || (selectedItem as any)?.material || undefined,
        supplierId: supplierId || undefined,
        damageDate,
        notes: notes || undefined,
      });

      showToast(`Recorded ${parsedQty} ${selectedItem?.unit || 'pcs'} as ${classification.toLowerCase()} stock.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to record damaged stock.');
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
              Record Damaged / Defective Stock
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
              Isolate defective textile units and remove them from sellable POS inventory
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#9ca3af',
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {/* Classification toggle */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Stock Classification *
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${classification === 'DAMAGED' ? '#ef4444' : '#e5e7eb'}`,
                  backgroundColor: classification === 'DAMAGED' ? '#fef2f2' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="classification"
                  value="DAMAGED"
                  checked={classification === 'DAMAGED'}
                  onChange={() => setClassification('DAMAGED')}
                  style={{ marginRight: '0.5rem' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: classification === 'DAMAGED' ? '#b91c1c' : '#374151' }}>
                    Damaged Stock
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    In-store transit, water, packaging, or handling damage
                  </div>
                </div>
              </label>

              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${classification === 'DEFECTIVE' ? '#f59e0b' : '#e5e7eb'}`,
                  backgroundColor: classification === 'DEFECTIVE' ? '#fffbeb' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="classification"
                  value="DEFECTIVE"
                  checked={classification === 'DEFECTIVE'}
                  onChange={() => setClassification('DEFECTIVE')}
                  style={{ marginRight: '0.5rem' }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: classification === 'DEFECTIVE' ? '#b45309' : '#374151' }}>
                    Defective Stock
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    Manufacturing, weaving, staining, or fabric defect
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Product selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Select Textile Product *
            </label>
            <input
              type="text"
              placeholder="Search by Product Name, SKU, or Barcode..."
              value={searchItem}
              onChange={(e) => setSearchItem(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                marginBottom: '0.5rem',
                boxSizing: 'border-box',
              }}
            />
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
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
              <option value="">-- Choose a Product --</option>
              {filteredItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} {item.sku ? `(${item.sku})` : ''} - Stock: {(item.currentStockMilli / 1000).toFixed(1)} {item.unit || 'pcs'}
                </option>
              ))}
            </select>
            {selectedItem && (
              <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#059669', fontWeight: 500 }}>
                Available Sellable Stock: {(selectedItem.currentStockMilli / 1000).toFixed(2)} {selectedItem.unit || 'pcs'}
              </div>
            )}
          </div>

          {/* Quantity & Reason row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Damaged Qty ({selectedItem?.unit || 'pcs'}) *
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
                Damage / Defect Reason *
              </label>
              <select
                value={damageReason}
                onChange={(e) => setDamageReason(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              >
                {DAMAGE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {damageReason === 'Other' && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Specify Custom Reason *
              </label>
              <input
                type="text"
                required
                placeholder="Describe the defect..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
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
          )}

          {/* Textile Attributes row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                Roll No (Fabrics)
              </label>
              <input
                type="text"
                placeholder="e.g. R-104"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                Batch / Lot
              </label>
              <input
                type="text"
                placeholder="e.g. B-2024"
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
                placeholder="e.g. XL, 42"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                Colour / Shade
              </label>
              <input
                type="text"
                placeholder="e.g. Maroon"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Supplier & Date row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Supplier (Optional for Return)
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">-- Choose Supplier (if known) --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                Damage Date
              </label>
              <input
                type="date"
                value={damageDate}
                onChange={(e) => setDamageDate(e.target.value)}
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

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
              Notes / Defect Observations
            </label>
            <textarea
              rows={2}
              placeholder="e.g. 2.5 meters cut tear near fold edge on Saree roll."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
                backgroundColor: '#dc2626',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Recording...' : 'Record & Remove from Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
