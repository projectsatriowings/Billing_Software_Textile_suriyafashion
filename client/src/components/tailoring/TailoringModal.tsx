import React, { useState, useEffect } from 'react';
import type { CustomerMeasurement, TailoringOrder } from '../../api.ts';
import {
  getCustomerMeasurements,
  saveCustomerMeasurement,
  createTailoringOrder,
  getTailoringOrders,
  updateTailoringOrder,
} from '../../api.ts';

interface TailoringModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated?: (order: TailoringOrder) => void;
}

export const TailoringModal: React.FC<TailoringModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'new_order' | 'active_orders'>('new_order');

  // Customer search & details
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [measurementId, setMeasurementId] = useState<string | null>(null);

  // Measurement fields
  const [chest, setChest] = useState<string>('');
  const [waist, setWaist] = useState<string>('');
  const [shoulder, setShoulder] = useState<string>('');
  const [sleeve, setSleeve] = useState<string>('');
  const [lengthVal, setLengthVal] = useState<string>('');
  const [neck, setNeck] = useState<string>('');
  const [hip, setHip] = useState<string>('');
  const [measurementNotes, setMeasurementNotes] = useState<string>('');
  const [savedMeasurementNotice, setSavedMeasurementNotice] = useState<string>('');

  // Order fields
  const [serviceType, setServiceType] = useState('stitching');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [totalRupees, setTotalRupees] = useState('350');
  const [advanceRupees, setAdvanceRupees] = useState('100');
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active orders list
  const [orders, setOrders] = useState<TailoringOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  // Live lookup of existing measurement profile when phone reaches 10 digits
  useEffect(() => {
    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
      getCustomerMeasurements(cleanPhone)
        .then((res) => {
          if (res.measurements && res.measurements.length > 0) {
            const m = res.measurements[0];
            setMeasurementId(m.id);
            if (!customerName && m.customerName) setCustomerName(m.customerName);
            if (m.customerId) setCustomerId(m.customerId);
            if (m.chest != null) setChest(String(m.chest));
            if (m.waist != null) setWaist(String(m.waist));
            if (m.shoulder != null) setShoulder(String(m.shoulder));
            if (m.sleeve != null) setSleeve(String(m.sleeve));
            if (m.length != null) setLengthVal(String(m.length));
            if (m.neck != null) setNeck(String(m.neck));
            if (m.hip != null) setHip(String(m.hip));
            if (m.notes) setMeasurementNotes(m.notes);
            setSavedMeasurementNotice(`✓ Found existing saved measurements for ${m.customerName}!`);
          } else {
            setSavedMeasurementNotice('');
          }
        })
        .catch(() => {});
    } else {
      setSavedMeasurementNotice('');
    }
  }, [customerPhone]);

  const loadOrders = () => {
    setOrdersLoading(true);
    getTailoringOrders({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then((res) => setOrders(res.orders || []))
      .catch((err) => console.error('Failed to load tailoring orders:', err))
      .finally(() => setOrdersLoading(false));
  };

  useEffect(() => {
    if (activeSubTab === 'active_orders') {
      loadOrders();
    }
  }, [activeSubTab, statusFilter]);

  if (!isOpen) return null;

  const totalPaise = Math.round((parseFloat(totalRupees) || 0) * 100);
  const advancePaise = Math.round((parseFloat(advanceRupees) || 0) * 100);
  const balancePaise = Math.max(0, totalPaise - advancePaise);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }
    if (!dueDate) {
      alert('Please select a due date');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Save or update customer measurement profile
      let finalMeasurementId = measurementId;
      if (chest || waist || shoulder || sleeve || lengthVal || neck || hip) {
        const mRes = await saveCustomerMeasurement({
          id: measurementId || undefined,
          customerId: customerId || undefined,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          chest: chest ? parseFloat(chest) : null,
          waist: waist ? parseFloat(waist) : null,
          shoulder: shoulder ? parseFloat(shoulder) : null,
          sleeve: sleeve ? parseFloat(sleeve) : null,
          length: lengthVal ? parseFloat(lengthVal) : null,
          neck: neck ? parseFloat(neck) : null,
          hip: hip ? parseFloat(hip) : null,
          notes: measurementNotes.trim() || null,
        });
        finalMeasurementId = mRes.measurement.id;
      }

      // 2. Create Tailoring Order with advance & due date
      const orderRes = await createTailoringOrder({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        customerId: customerId || null,
        measurementId: finalMeasurementId,
        serviceType,
        description: description.trim() || null,
        dueDate,
        totalMinor: totalPaise,
        advancePaidMinor: advancePaise,
        balanceMinor: balancePaise,
        notes: orderNotes.trim() || null,
      });

      if (onOrderCreated) {
        onOrderCreated(orderRes.order);
      }
      setActiveSubTab('active_orders');
    } catch (err: any) {
      alert(err.message || 'Failed to save tailoring order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: TailoringOrder['status']) => {
    try {
      await updateTailoringOrder(orderId, { status: newStatus });
      loadOrders();
    } catch (err: any) {
      alert(err.message || 'Failed to update order status');
    }
  };

  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

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
          maxWidth: '820px',
          maxHeight: '92vh',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#4f46e5',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}
            >
              ✂️
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                Tailoring, Stitching &amp; Measurement Master
              </h3>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Record customer body measurements and manage stitching orders with advance &amp; due date
              </div>
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

        {/* Sub Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#ffffff', padding: '0 1.5rem' }}>
          <button
            type="button"
            onClick={() => setActiveSubTab('new_order')}
            style={{
              padding: '0.85rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              border: 'none',
              borderBottom: activeSubTab === 'new_order' ? '3px solid #4f46e5' : '3px solid transparent',
              background: 'transparent',
              color: activeSubTab === 'new_order' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
            }}
          >
            + New Tailoring Order
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('active_orders')}
            style={{
              padding: '0.85rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              border: 'none',
              borderBottom: activeSubTab === 'active_orders' ? '3px solid #4f46e5' : '3px solid transparent',
              background: 'transparent',
              color: activeSubTab === 'active_orders' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
            }}
          >
            📋 Active Orders &amp; Due Dates
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {activeSubTab === 'new_order' ? (
            <form onSubmit={handleSubmitOrder}>
              {/* Customer Info Card */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.2rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
                  1. Customer Details (Auto-Loads Saved Measurements)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Customer Mobile Number *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 9876543210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Priya Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                {savedMeasurementNotice && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                    {savedMeasurementNotice}
                  </div>
                )}
              </div>

              {/* Measurement Profile Card */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.2rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                    2. Body Measurement Profile (Inches)
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Re-used automatically for future orders</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Chest / Bust</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 36"'
                      value={chest}
                      onChange={(e) => setChest(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Waist</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 30"'
                      value={waist}
                      onChange={(e) => setWaist(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Shoulder</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 14.5"'
                      value={shoulder}
                      onChange={(e) => setShoulder(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Sleeve Length</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 18"'
                      value={sleeve}
                      onChange={(e) => setSleeve(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Full Length</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 42"'
                      value={lengthVal}
                      onChange={(e) => setLengthVal(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Neck</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 7"'
                      value={neck}
                      onChange={(e) => setNeck(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Hip</label>
                    <input
                      type="number"
                      step="0.25"
                      className="form-input"
                      placeholder='e.g. 38"'
                      value={hip}
                      onChange={(e) => setHip(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Fit / Collar Notes</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Slim fit, Boat neck"
                      value={measurementNotes}
                      onChange={(e) => setMeasurementNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Order & Billing Details */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.2rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
                  3. Tailoring Order, Advance &amp; Due Date
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Service Type
                    </label>
                    <select
                      className="form-input"
                      value={serviceType}
                      onChange={(e) => setServiceType(e.target.value)}
                    >
                      <option value="stitching">Full Stitching</option>
                      <option value="kurti">Kurti / Salwar</option>
                      <option value="blouse">Blouse Stitching</option>
                      <option value="alteration">Alteration &amp; Fitting</option>
                      <option value="fall_pico">Saree Fall &amp; Pico</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Delivery Due Date *
                    </label>
                    <input
                      type="date"
                      className="form-input"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Total Stitching Charge (₹)
                    </label>
                    <input
                      type="number"
                      className="form-input"
                      value={totalRupees}
                      onChange={(e) => setTotalRupees(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Advance Paid (₹)
                    </label>
                    <input
                      type="number"
                      className="form-input"
                      value={advanceRupees}
                      onChange={(e) => setAdvanceRupees(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Balance Due on Delivery
                    </label>
                    <div
                      style={{
                        padding: '0.55rem 0.75rem',
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: 800,
                        color: balancePaise > 0 ? '#ea580c' : '#16a34a',
                        fontSize: '1rem',
                      }}
                    >
                      {formatRupees(balancePaise)}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>
                      Pattern / Work Notes
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Lining fabric provided"
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                  style={{ padding: '0.6rem 1.5rem', fontWeight: 700 }}
                >
                  {isSubmitting ? 'Creating Order...' : 'Create Tailoring Order & Slip'}
                </button>
              </div>
            </form>
          ) : (
            <div>
              {/* Filter */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {['all', 'pending', 'in_progress', 'ready', 'delivered'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        border: '1px solid',
                        borderColor: statusFilter === st ? '#4f46e5' : '#cbd5e1',
                        background: statusFilter === st ? '#4f46e5' : '#ffffff',
                        color: statusFilter === st ? '#ffffff' : '#475569',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                      onClick={() => setStatusFilter(st)}
                    >
                      {st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={loadOrders}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                >
                  ↻ Refresh
                </button>
              </div>

              {ordersLoading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  Loading tailoring orders...
                </div>
              ) : orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  No tailoring orders found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {orders.map((ord) => {
                    const isDueSoon = new Date(ord.dueDate).getTime() - Date.now() < 86400000 * 2;
                    return (
                      <div
                        key={ord.id}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '1rem',
                          background: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 800, color: '#1e293b', fontSize: '0.95rem' }}>
                              #{ord.orderNumber}
                            </span>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background:
                                  ord.status === 'ready'
                                    ? '#dcfce7'
                                    : ord.status === 'delivered'
                                    ? '#f1f5f9'
                                    : isDueSoon
                                    ? '#fef2f2'
                                    : '#fef3c7',
                                color:
                                  ord.status === 'ready'
                                    ? '#15803d'
                                    : ord.status === 'delivered'
                                    ? '#475569'
                                    : isDueSoon
                                    ? '#b91c1c'
                                    : '#b45309',
                              }}
                            >
                              {ord.status.replace('_', ' ')}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'capitalize' }}>
                              {ord.serviceType.replace('_', ' ')}
                            </span>
                          </div>

                          <div style={{ fontSize: '0.85rem', color: '#334155', marginTop: '4px' }}>
                            <strong>{ord.customerName}</strong> {ord.customerPhone ? `(${ord.customerPhone})` : ''}
                          </div>

                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                            Due Date: <strong style={{ color: isDueSoon ? '#b91c1c' : '#334155' }}>{ord.dueDate}</strong>
                            {ord.notes ? ` • Note: ${ord.notes}` : ''}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>
                            Total: {formatRupees(ord.totalMinor)}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            Adv: {formatRupees(ord.advancePaidMinor)} • Bal:{' '}
                            <strong style={{ color: ord.balanceMinor > 0 ? '#ea580c' : '#16a34a' }}>
                              {formatRupees(ord.balanceMinor)}
                            </strong>
                          </div>

                          {/* Quick Status Update */}
                          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                            {ord.status === 'pending' && (
                              <button
                                type="button"
                                style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
                                onClick={() => handleUpdateStatus(ord.id, 'in_progress')}
                              >
                                Mark In Progress
                              </button>
                            )}
                            {ord.status === 'in_progress' && (
                              <button
                                type="button"
                                style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer' }}
                                onClick={() => handleUpdateStatus(ord.id, 'ready')}
                              >
                                Mark Ready
                              </button>
                            )}
                            {ord.status === 'ready' && (
                              <button
                                type="button"
                                style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: '#64748b', color: '#fff', border: 'none', cursor: 'pointer' }}
                                onClick={() => handleUpdateStatus(ord.id, 'delivered')}
                              >
                                Deliver &amp; Collect
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
