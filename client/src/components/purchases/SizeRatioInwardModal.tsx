import React, { useState } from 'react';
import type { Item } from '../../api.ts';
import { createJobWork } from '../../api.ts';

interface SizeRatioInwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  onAddLinesToPurchase: (lines: Array<{
    itemId: string;
    variantId?: string | null;
    name: string;
    billedQtyMilli: number;
    receivedQtyMilli: number;
    costMinor: number;
    taxRateBp: number;
    unit: string;
  }>) => void;
}

export const SizeRatioInwardModal: React.FC<SizeRatioInwardModalProps> = ({
  isOpen,
  onClose,
  items,
  onAddLinesToPurchase,
}) => {
  const [activeTab, setActiveTab] = useState<'size_ratio' | 'fabric' | 'job_work'>('size_ratio');

  // Size ratio state
  const [selectedItemId, setSelectedItemId] = useState<string>(items[0]?.id || '');
  const [totalPcs, setTotalPcs] = useState('120');
  const [costPerPcRupees, setCostPerPcRupees] = useState('220');
  const [sizeRatioPairs, setSizeRatioPairs] = useState([
    { size: 'S', ratio: 1 },
    { size: 'M', ratio: 2 },
    { size: 'L', ratio: 2 },
    { size: 'XL', ratio: 1 },
  ]);

  // Fabric inward state
  const [fabricItemId, setFabricItemId] = useState<string>(items[0]?.id || '');
  const [fabricTotalMeters, setFabricTotalMeters] = useState('200');
  const [fabricCostPerMeter, setFabricCostPerMeter] = useState('110');
  const [wastagePct, setWastagePct] = useState('5'); // 5% shrinkage / cutting loss

  // Job Work state
  const [jwWorkerName, setJwWorkerName] = useState('');
  const [jwWorkerPhone, setJwWorkerPhone] = useState('');
  const [jwFabricMeters, setJwFabricMeters] = useState('100');
  const [jwWastagePct, setJwWastagePct] = useState('5');
  const [jwExpectedPcs, setJwExpectedPcs] = useState('40');
  const [jwCostPerPc, setJwCostPerPc] = useState('75');
  const [jwSubmitting, setJwSubmitting] = useState(false);
  const [jwSuccess, setJwSuccess] = useState('');

  if (!isOpen) return null;

  // Largest remainder ratio allocation
  const totalRatio = sizeRatioPairs.reduce((sum, p) => sum + Math.max(0, p.ratio), 0);
  const targetTotal = Math.max(0, parseInt(totalPcs, 10) || 0);

  const calculatedQuantities = (() => {
    if (totalRatio === 0 || targetTotal === 0) return sizeRatioPairs.map(() => 0);
    const raw = sizeRatioPairs.map((p) => (targetTotal * p.ratio) / totalRatio);
    const base = raw.map((r) => Math.floor(r));
    let left = targetTotal - base.reduce((a, b) => a + b, 0);
    const remainders = raw
      .map((r, i) => ({ i, remainder: r - Math.floor(r) }))
      .sort((a, b) => b.remainder - a.remainder);
    for (let k = 0; left > 0 && k < remainders.length; k++, left--) {
      base[remainders[k].i] += 1;
    }
    return base;
  })();

  const handleApplySizeRatio = () => {
    const item = items.find((i) => i.id === selectedItemId);
    if (!item) {
      alert('Please select an item');
      return;
    }
    const costMinor = Math.round((parseFloat(costPerPcRupees) || 0) * 100);

    const lines = sizeRatioPairs.map((p, idx) => {
      const qty = calculatedQuantities[idx];
      return {
        itemId: item.id,
        name: `${item.name} (${p.size})`,
        billedQtyMilli: qty * 1000,
        receivedQtyMilli: qty * 1000,
        costMinor,
        taxRateBp: item.taxRateBp || 0,
        unit: item.unit || 'pcs',
      };
    }).filter((l) => l.receivedQtyMilli > 0);

    onAddLinesToPurchase(lines);
    onClose();
  };

  const handleApplyFabricInward = () => {
    const item = items.find((i) => i.id === fabricItemId);
    if (!item) {
      alert('Please select a fabric item');
      return;
    }
    const totalM = parseFloat(fabricTotalMeters) || 0;
    const waste = parseFloat(wastagePct) || 0;
    const netM = totalM * (1 - waste / 100);
    const costPerM = Math.round((parseFloat(fabricCostPerMeter) || 0) * 100);

    onAddLinesToPurchase([
      {
        itemId: item.id,
        name: `${item.name} (${totalM}m inward, net: ${netM.toFixed(2)}m after ${waste}% wastage)`,
        billedQtyMilli: Math.round(totalM * 1000),
        receivedQtyMilli: Math.round(netM * 1000),
        costMinor: costPerM,
        taxRateBp: item.taxRateBp || 0,
        unit: 'm',
      },
    ]);
    onClose();
  };

  const handleCreateJobWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jwWorkerName.trim()) {
      alert('Please enter worker or tailor name');
      return;
    }
    setJwSubmitting(true);
    setJwSuccess('');
    try {
      const jw = await createJobWork({
        workerName: jwWorkerName.trim(),
        workerPhone: jwWorkerPhone.trim() || null,
        fabricIssuedMeters: parseFloat(jwFabricMeters) || 0,
        wastagePct: parseFloat(jwWastagePct) || 0,
        piecesExpected: parseInt(jwExpectedPcs, 10) || 0,
        costPerPieceMinor: Math.round((parseFloat(jwCostPerPc) || 0) * 100),
        issueDate: new Date().toISOString().slice(0, 10),
      });
      setJwSuccess(`✓ Job Work #${jw.jobWork.jobNumber} created successfully for ${jw.jobWork.workerName}!`);
      setJwWorkerName('');
    } catch (err: any) {
      alert(err.message || 'Failed to create job work');
    } finally {
      setJwSubmitting(false);
    }
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
            background: '#f8fafc',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
              Textile Purchase &amp; Inward Tools
            </h3>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Size-Ratio Inward • Fabric Inward with Wastage % • Job-Work Issue
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
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#ffffff', padding: '0 1.5rem' }}>
          <button
            type="button"
            onClick={() => setActiveTab('size_ratio')}
            style={{
              padding: '0.75rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              border: 'none',
              borderBottom: activeTab === 'size_ratio' ? '3px solid #4f46e5' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'size_ratio' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
            }}
          >
            Size-Ratio Inward
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('fabric')}
            style={{
              padding: '0.75rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              border: 'none',
              borderBottom: activeTab === 'fabric' ? '3px solid #4f46e5' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'fabric' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
            }}
          >
            Fabric Inward (Metres &amp; Wastage %)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('job_work')}
            style={{
              padding: '0.75rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              border: 'none',
              borderBottom: activeTab === 'job_work' ? '3px solid #4f46e5' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'job_work' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
            }}
          >
            Job-Work Issue
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'size_ratio' && (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  Select Master Product
                </label>
                <select
                  className="form-input"
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                >
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Total Quantity (Pieces)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={totalPcs}
                    onChange={(e) => setTotalPcs(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Cost Rate Per Piece (₹)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={costPerPcRupees}
                    onChange={(e) => setCostPerPcRupees(e.target.value)}
                  />
                </div>
              </div>

              {/* Ratio Setup */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b', marginBottom: '0.75rem' }}>
                  Size Ratio Distribution (e.g. S:M:L:XL = 1:2:2:1)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                  {sizeRatioPairs.map((p, idx) => (
                    <div key={p.size} style={{ background: '#ffffff', padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#1e293b' }}>Size {p.size}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Ratio:</span>
                        <input
                          type="number"
                          style={{ width: '45px', padding: '2px 4px', fontSize: '0.85rem', fontWeight: 700 }}
                          value={p.ratio}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 0;
                            setSizeRatioPairs((prev) => prev.map((pr, i) => (i === idx ? { ...pr, ratio: val } : pr)));
                          }}
                        />
                      </div>
                      <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', fontWeight: 800, color: '#4f46e5' }}>
                        Qty: {calculatedQuantities[idx]} pcs
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApplySizeRatio}
                  style={{ fontWeight: 700 }}
                >
                  Insert {targetTotal} Ratio Lines into Bill
                </button>
              </div>
            </div>
          )}

          {activeTab === 'fabric' && (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  Select Fabric Product
                </label>
                <select
                  className="form-input"
                  value={fabricItemId}
                  onChange={(e) => setFabricItemId(e.target.value)}
                >
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Total Roll Metres
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    value={fabricTotalMeters}
                    onChange={(e) => setFabricTotalMeters(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Wastage / Shrinkage %
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input"
                    value={wastagePct}
                    onChange={(e) => setWastagePct(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Cost Per Metre (₹)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={fabricCostPerMeter}
                    onChange={(e) => setFabricCostPerMeter(e.target.value)}
                  />
                </div>
              </div>

              {/* Calculated Summary */}
              {(() => {
                const totalM = parseFloat(fabricTotalMeters) || 0;
                const waste = parseFloat(wastagePct) || 0;
                const netM = totalM * (1 - waste / 100);
                const rate = parseFloat(fabricCostPerMeter) || 0;
                const totalCost = totalM * rate;
                const effectiveRate = netM > 0 ? totalCost / netM : 0;

                return (
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Billed Metres:</span>
                      <strong>{totalM.toFixed(2)} m</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Estimated Cutting/Shrinkage Loss ({waste}%):</span>
                      <strong style={{ color: '#ea580c' }}>-{(totalM * (waste / 100)).toFixed(2)} m</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Net Usable Stock Inward:</span>
                      <strong style={{ color: '#16a34a', fontSize: '1.05rem' }}>{netM.toFixed(2)} m</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #cbd5e1', paddingTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Effective Usable Cost / Metre:</span>
                      <strong style={{ color: '#4f46e5' }}>₹{effectiveRate.toFixed(2)} / m</strong>
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApplyFabricInward}
                  style={{ fontWeight: 700 }}
                >
                  Insert Fabric Line into Bill
                </button>
              </div>
            </div>
          )}

          {activeTab === 'job_work' && (
            <form onSubmit={handleCreateJobWork}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Tailor / Worker Name *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Master Ramesh Tailors"
                    value={jwWorkerName}
                    onChange={(e) => setJwWorkerName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Tailor Mobile Number
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 9876543210"
                    value={jwWorkerPhone}
                    onChange={(e) => setJwWorkerPhone(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Fabric Metres Issued</label>
                  <input
                    type="number"
                    className="form-input"
                    value={jwFabricMeters}
                    onChange={(e) => setJwFabricMeters(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Wastage Allowed %</label>
                  <input
                    type="number"
                    className="form-input"
                    value={jwWastagePct}
                    onChange={(e) => setJwWastagePct(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Expected Pieces</label>
                  <input
                    type="number"
                    className="form-input"
                    value={jwExpectedPcs}
                    onChange={(e) => setJwExpectedPcs(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Cost / Pc (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={jwCostPerPc}
                    onChange={(e) => setJwCostPerPc(e.target.value)}
                  />
                </div>
              </div>

              {jwSuccess && (
                <div style={{ padding: '0.65rem 0.85rem', background: '#dcfce7', color: '#15803d', borderRadius: '8px', fontWeight: 700, fontSize: '0.85rem', marginBottom: '1rem' }}>
                  {jwSuccess}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Close
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={jwSubmitting}
                  style={{ fontWeight: 700 }}
                >
                  {jwSubmitting ? 'Creating...' : 'Issue Job Work Order'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
