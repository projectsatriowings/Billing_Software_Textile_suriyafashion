import React, { useState, useEffect } from 'react';
import type { Item, ProductVariant } from '../../api.ts';
import { getItemVariants } from '../../api.ts';

interface VariantPickerModalProps {
  item: Item;
  isOpen: boolean;
  onClose: () => void;
  onSelectVariant: (variant: ProductVariant, qty?: number) => void;
  mode?: 'add_to_cart' | 'exchange';
  currentVariantId?: string | null;
  onExchangeVariant?: (oldVariantId: string | null, newVariant: ProductVariant) => void;
}

export const VariantPickerModal: React.FC<VariantPickerModalProps> = ({
  item,
  isOpen,
  onClose,
  onSelectVariant,
  mode = 'add_to_cart',
  currentVariantId,
  onExchangeVariant,
}) => {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<string>('all');
  const [selectedColour, setSelectedColour] = useState<string>('all');
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);

  useEffect(() => {
    if (!isOpen || !item?.id) return;
    setLoading(true);
    getItemVariants(item.id)
      .then((res) => {
        setVariants(res.variants || []);
        if (res.variants && res.variants.length > 0) {
          const matchCurrent = currentVariantId
            ? res.variants.find((v) => v.id === currentVariantId)
            : null;
          setSelectedVariant(matchCurrent || res.variants[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to load variants:', err);
      })
      .finally(() => setLoading(false));
  }, [isOpen, item?.id, currentVariantId]);

  if (!isOpen) return null;

  // Extract unique sizes and colours for filtering
  const sizes = Array.from(new Set(variants.map((v) => v.size).filter(Boolean))) as string[];
  const colours = Array.from(new Set(variants.map((v) => v.colour).filter(Boolean))) as string[];

  const filteredVariants = variants.filter((v) => {
    if (selectedSize !== 'all' && v.size !== selectedSize) return false;
    if (selectedColour !== 'all' && v.colour !== selectedColour) return false;
    return true;
  });

  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  const currentVar = variants.find((v) => v.id === currentVariantId);
  const priceDiff = selectedVariant && currentVar
    ? selectedVariant.priceMinor - currentVar.priceMinor
    : 0;

  const handleConfirm = () => {
    if (!selectedVariant) return;
    if (mode === 'exchange' && onExchangeVariant) {
      onExchangeVariant(currentVariantId || null, selectedVariant);
    } else {
      onSelectVariant(selectedVariant);
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          animation: 'modalSlideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: mode === 'exchange' ? '#f0fdf4' : '#f8fafc',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  background: mode === 'exchange' ? '#16a34a' : '#4f46e5',
                  color: '#ffffff',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  letterSpacing: '0.04em',
                }}
              >
                {mode === 'exchange' ? 'One-Tap Exchange' : 'Select Size & Colour'}
              </span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                {item.name}
              </h3>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '4px' }}>
              {mode === 'exchange'
                ? 'Swap size or colour with automatic price-difference settlement'
                : 'Choose the variant to add to current bill'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.4rem',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.25rem',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            background: '#ffffff',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          {sizes.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Size:</span>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: selectedSize === 'all' ? '#4f46e5' : '#cbd5e1',
                    background: selectedSize === 'all' ? '#4f46e5' : '#ffffff',
                    color: selectedSize === 'all' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSize('all')}
                >
                  All
                </button>
                {sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: selectedSize === s ? '#4f46e5' : '#cbd5e1',
                      background: selectedSize === s ? '#4f46e5' : '#ffffff',
                      color: selectedSize === s ? '#ffffff' : '#475569',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedSize(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {colours.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Colour:</span>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: selectedColour === 'all' ? '#4f46e5' : '#cbd5e1',
                    background: selectedColour === 'all' ? '#4f46e5' : '#ffffff',
                    color: selectedColour === 'all' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedColour('all')}
                >
                  All
                </button>
                {colours.map((c) => (
                  <button
                    key={c}
                    type="button"
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: selectedColour === c ? '#4f46e5' : '#cbd5e1',
                      background: selectedColour === c ? '#4f46e5' : '#ffffff',
                      color: selectedColour === c ? '#ffffff' : '#475569',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedColour(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Variant Cards Grid */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, minHeight: '220px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              Loading sizes and colours...
            </div>
          ) : filteredVariants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              No variants match the selected filters.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.75rem',
              }}
            >
              {filteredVariants.map((v) => {
                const isSelected = selectedVariant?.id === v.id;
                const isCurrent = currentVariantId === v.id;
                const inStock = v.stockMilli > 0;

                return (
                  <div
                    key={v.id}
                    onClick={() => inStock && setSelectedVariant(v)}
                    style={{
                      border: '2px solid',
                      borderColor: isSelected ? '#4f46e5' : isCurrent ? '#16a34a' : '#e2e8f0',
                      borderRadius: '12px',
                      padding: '0.85rem',
                      cursor: inStock ? 'pointer' : 'not-allowed',
                      background: isSelected
                        ? '#eef2ff'
                        : isCurrent
                        ? '#f0fdf4'
                        : inStock
                        ? '#ffffff'
                        : '#f8fafc',
                      opacity: inStock ? 1 : 0.6,
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                  >
                    {isCurrent && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          background: '#16a34a',
                          color: '#fff',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '4px',
                        }}
                      >
                        CURRENT
                      </span>
                    )}

                    <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.4rem' }}>
                      {v.size && (
                        <span
                          style={{
                            background: '#1e293b',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}
                        >
                          {v.size}
                        </span>
                      )}
                      {v.colour && (
                        <span
                          style={{
                            background: '#f1f5f9',
                            color: '#334155',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          {v.colour}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                        {formatRupees(v.priceMinor)}
                      </span>
                      {v.mrpMinor && v.mrpMinor > v.priceMinor && (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', textDecoration: 'line-through' }}>
                          {formatRupees(v.mrpMinor)}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: '0.5rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: inStock ? '#059669' : '#dc2626',
                      }}
                    >
                      <span>{inStock ? `Stock: ${v.stockMilli / 1000}` : 'Out of Stock'}</span>
                      {v.sku && <span style={{ color: '#94a3b8' }}>{v.sku}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Exchange Settlement Bar (in exchange mode) */}
        {mode === 'exchange' && selectedVariant && currentVar && (
          <div
            style={{
              padding: '0.85rem 1.5rem',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Price Difference: </span>
              {priceDiff === 0 ? (
                <span style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.95rem' }}>
                  ₹0.00 (Even Exchange — No Extra Charge)
                </span>
              ) : priceDiff > 0 ? (
                <span style={{ fontWeight: 800, color: '#b91c1c', fontSize: '0.95rem' }}>
                  Customer Pays +{formatRupees(priceDiff)}
                </span>
              ) : (
                <span style={{ fontWeight: 800, color: '#2563eb', fontSize: '0.95rem' }}>
                  Refund / Credit {formatRupees(Math.abs(priceDiff))}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Exchange {currentVar.size || 'Base'} ({formatRupees(currentVar.priceMinor)}) ➔{' '}
              {selectedVariant.size || 'Base'} ({formatRupees(selectedVariant.priceMinor)})
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            background: '#ffffff',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '0.5rem 1.25rem', fontSize: '0.9rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selectedVariant || selectedVariant.stockMilli <= 0}
            onClick={handleConfirm}
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '0.9rem',
              fontWeight: 700,
              background: mode === 'exchange' ? '#16a34a' : '#4f46e5',
            }}
          >
            {mode === 'exchange' ? 'Confirm Size Exchange' : 'Add Variant to Bill'}
          </button>
        </div>
      </div>
    </div>
  );
};
