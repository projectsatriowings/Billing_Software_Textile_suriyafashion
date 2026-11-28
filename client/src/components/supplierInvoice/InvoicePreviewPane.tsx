import React, { useState } from 'react';
import type { InvoiceBoundingBox } from '../../api';

interface InvoicePreviewPaneProps {
  file: File | null;
  previewUrl: string | null;
  pageCount: number;
  highlightedBbox?: InvoiceBoundingBox | null;
  highlightedRowOrder?: number | null;
}

export function InvoicePreviewPane({
  file,
  previewUrl,
  pageCount,
  highlightedBbox,
  highlightedRowOrder,
}: InvoicePreviewPaneProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const isPdf = Boolean(file?.type.includes('pdf') || file?.name.toLowerCase().endsWith('.pdf'));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f1f5f9',
        borderRight: '1px solid var(--border)',
        minHeight: 0,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: '0.5rem 0.75rem',
          background: '#ffffff',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)' }}>
          Original Invoice {highlightedRowOrder ? `· Row #${highlightedRowOrder}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.2) * 10) / 10))}
            style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}
            title="Zoom Out"
          >
            −
          </button>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, minWidth: '42px', textAlign: 'center', color: '#475569' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.2) * 10) / 10))}
            style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            style={{ padding: '0.25rem 0.55rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}
            title="Rotate 90°"
          >
            ↻
          </button>
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.25rem' }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.72rem', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
              >
                ‹
              </button>
              <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                {currentPage}/{pageCount}
              </span>
              <button
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                style={{ padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.72rem', cursor: currentPage >= pageCount ? 'not-allowed' : 'pointer' }}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Viewer */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        {previewUrl && !isPdf ? (
          <div
            style={{
              position: 'relative',
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: 'top center',
              transition: 'transform 0.15s ease',
            }}
          >
            <img
              src={previewUrl}
              alt="Original supplier invoice"
              style={{ maxWidth: '100%', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', display: 'block' }}
            />
            {highlightedBbox && highlightedBbox.unit === 'normalized' && highlightedBbox.page === currentPage && (
              <div
                style={{
                  position: 'absolute',
                  left: `${highlightedBbox.x * 100}%`,
                  top: `${highlightedBbox.y * 100}%`,
                  width: `${highlightedBbox.width * 100}%`,
                  height: `${highlightedBbox.height * 100}%`,
                  border: '2px solid var(--primary)',
                  background: 'rgba(109, 74, 255, 0.14)',
                  borderRadius: '4px',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        ) : previewUrl && isPdf ? (
          <iframe
            src={`${previewUrl}#page=${currentPage}`}
            title="PDF Invoice Preview"
            style={{ width: '100%', height: '100%', minHeight: '420px', border: 'none', borderRadius: '8px', background: '#fff' }}
          />
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.84rem' }}>
            Preview unavailable for this file.
          </div>
        )}
      </div>
    </div>
  );
}
