import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { api, setToken, type User, type Shop } from '../api';
import './auth/modernLogin.css';

const StoreLogoIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const MailIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const UserIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LockIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/** Distinct minimalist line-art illustration for each role */
const RoleIllustration: React.FC<{ role: 'super_admin' | 'store_manager' | 'cashier' }> = ({ role }) => {
  if (role === 'cashier') {
    return (
      <svg className="rl-illustration-svg" viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Background POS Terminal & Counter */}
        <rect x="65" y="128" width="290" height="132" rx="6" fill="#F9DFD1" stroke="#264143" strokeWidth="2.4" />
        <rect x="85" y="150" width="250" height="110" fill="#FFFFFF" stroke="#264143" strokeWidth="2" />
        {/* POS Monitor */}
        <rect x="118" y="48" width="128" height="72" rx="6" fill="#DCEEF2" stroke="#264143" strokeWidth="2.4" />
        <rect x="130" y="60" width="104" height="44" rx="3" fill="#FFFFFF" stroke="#264143" strokeWidth="1.8" />
        <line x1="142" y1="74" x2="196" y2="74" stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="142" y1="86" x2="178" y2="86" stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="216" cy="80" r="9" fill="#D5EBE1" stroke="#264143" strokeWidth="2" />
        <path d="M172 120v8M192 120v8M158 128h48" stroke="#264143" strokeWidth="2.4" strokeLinecap="round" />
        {/* Receipt Printer & Paper */}
        <rect x="272" y="88" width="56" height="40" rx="4" fill="#D5EBE1" stroke="#264143" strokeWidth="2.4" />
        <path d="M282 88V50l6 4 6-4 6 4 6-4 6 4 6-4v38" fill="#FFFFFF" stroke="#264143" strokeWidth="2" strokeLinejoin="round" />
        <line x1="288" y1="64" x2="312" y2="64" stroke="#264143" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="288" y1="73" x2="306" y2="73" stroke="#264143" strokeWidth="1.8" strokeLinecap="round" />
        {/* Barcode Scanner & Decorative Trees */}
        <rect x="110" y="176" width="76" height="46" rx="4" fill="#F4E9D2" stroke="#264143" strokeWidth="2" />
        <line x1="126" y1="188" x2="126" y2="210" stroke="#264143" strokeWidth="2" />
        <line x1="134" y1="188" x2="134" y2="210" stroke="#264143" strokeWidth="2" />
        <line x1="144" y1="188" x2="144" y2="210" stroke="#264143" strokeWidth="3" />
        <line x1="154" y1="188" x2="154" y2="210" stroke="#264143" strokeWidth="2" />
        <line x1="164" y1="188" x2="164" y2="210" stroke="#264143" strokeWidth="2.5" />
        <path d="M36 260v-44c-14 0-22-12-22-24 0-12 10-22 22-22 12 0 22 10 22 22 0 12-8 24-22 24z" fill="#D5EBE1" stroke="#264143" strokeWidth="2.2" />
        <path d="M384 260v-38c-12 0-18-10-18-20 0-10 8-18 18-18 10 0 18 8 18 18 0 10-6 20-18 20z" fill="#D5EBE1" stroke="#264143" strokeWidth="2.2" />
      </svg>
    );
  }

  if (role === 'store_manager') {
    return (
      <svg className="rl-illustration-svg" viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Storefront & Inventory Warehouse */}
        <rect x="78" y="84" width="150" height="176" fill="#FFFFFF" stroke="#264143" strokeWidth="2.4" />
        <polygon points="66,84 240,84 226,52 80,52" fill="#F9DFD1" stroke="#264143" strokeWidth="2.4" strokeLinejoin="round" />
        <rect x="228" y="112" width="118" height="148" fill="#DCEEF2" stroke="#264143" strokeWidth="2.4" />
        {/* Shelves / Stock Boxes */}
        <rect x="100" y="110" width="44" height="36" fill="#F4E9D2" stroke="#264143" strokeWidth="2" />
        <rect x="160" y="110" width="44" height="36" fill="#D5EBE1" stroke="#264143" strokeWidth="2" />
        <rect x="100" y="164" width="44" height="36" fill="#DCEEF2" stroke="#264143" strokeWidth="2" />
        <rect x="160" y="164" width="44" height="36" fill="#F9DFD1" stroke="#264143" strokeWidth="2" />
        <rect x="252" y="138" width="70" height="52" fill="#FFFFFF" stroke="#264143" strokeWidth="2" />
        <line x1="264" y1="154" x2="308" y2="154" stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="264" y1="168" x2="296" y2="168" stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="268" y="206" width="38" height="54" fill="#F4E9D2" stroke="#264143" strokeWidth="2" />
        <path d="M44 260v-48c-15 0-24-13-24-26 0-13 11-24 24-24 13 0 24 11 24 24 0 13-9 26-24 26z" fill="#D5EBE1" stroke="#264143" strokeWidth="2.2" />
        <path d="M378 260v-42c-13 0-20-11-20-22 0-11 9-20 20-20 11 0 20 9 20 20 0 11-7 22-20 22z" fill="#D5EBE1" stroke="#264143" strokeWidth="2.2" />
      </svg>
    );
  }

  // Admin: Architectural Storefront & Towers (matching reference line-art style)
  return (
    <svg className="rl-illustration-svg" viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="32,260 32,126 108,104 108,260" fill="#DCEEF2" stroke="#264143" strokeWidth="2.4" strokeLinejoin="round" />
      <polygon points="108,260 108,68 186,44 186,260" fill="#FFFFFF" stroke="#264143" strokeWidth="2.4" strokeLinejoin="round" />
      <polygon points="186,260 186,102 252,126 252,260" fill="#F9DFD1" stroke="#264143" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="252" y="34" width="96" height="226" fill="#FFFFFF" stroke="#264143" strokeWidth="2.4" />
      <polygon points="348,260 348,74 396,96 396,260" fill="#D5EBE1" stroke="#264143" strokeWidth="2.4" strokeLinejoin="round" />
      {/* Architectural Window Lines */}
      <line x1="126" y1="86" x2="126" y2="236" stroke="#264143" strokeWidth="2" strokeLinecap="round" />
      <line x1="146" y1="80" x2="146" y2="236" stroke="#264143" strokeWidth="2" strokeLinecap="round" />
      <line x1="166" y1="74" x2="166" y2="236" stroke="#264143" strokeWidth="2" strokeLinecap="round" />
      {[56, 82, 108, 134, 160].map((y) => (
        <g key={y}>
          <line x1="274" y1={y} x2="274" y2={y + 12} stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="298" y1={y} x2="298" y2={y + 12} stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="322" y1={y} x2="322" y2={y + 12} stroke="#264143" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ))}
      <path d="M74 260v-36c-12 0-18-10-18-20 0-10 8-18 18-18 10 0 18 8 18 18 0 10-6 20-18 20z" fill="#D5EBE1" stroke="#264143" strokeWidth="2.2" />
      <path d="M222 260v-42c-14 0-21-11-21-22 0-11 9-21 21-21 12 0 21 10 21 21 0 11-7 22-21 22z" fill="#F4E9D2" stroke="#264143" strokeWidth="2.2" />
      <path d="M372 260v-32c-11 0-16-9-16-18 0-9 7-16 16-16 9 0 16 7 16 16 0 9-5 18-16 18z" fill="#F9DFD1" stroke="#264143" strokeWidth="2.2" />
    </svg>
  );
};

interface LoginPageProps {
  initialRole?: 'super_admin' | 'store_manager' | 'cashier';
  onSuccess: (data: { token: string; user: User; shop: Shop }) => void;
  onNavigateRegister: () => void;
  onBackToHome?: () => void;
  onRequirePasswordChange?: (params: {
    changeToken: string;
    tempPassword?: string;
    identifier?: string;
  }) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  initialRole,
  onSuccess,
  onBackToHome,
  onRequirePasswordChange,
}) => {
  const detectInitialRole = (): 'super_admin' | 'store_manager' | 'cashier' => {
    if (initialRole) return initialRole;
    try {
      const hash = (typeof window !== 'undefined' ? window.location.hash : '').toLowerCase();
      const search = (typeof window !== 'undefined' ? window.location.search : '').toLowerCase();
      if (hash.includes('cashier') || search.includes('cashier')) return 'cashier';
      if (hash.includes('manager') || search.includes('manager')) return 'store_manager';
    } catch { }
    return 'super_admin';
  };

  const [selectedRole, setSelectedRole] = useState<'super_admin' | 'store_manager' | 'cashier'>(detectInitialRole);
  // No demo logins prefilled
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRoleChange = (role: 'super_admin' | 'store_manager' | 'cashier') => {
    setSelectedRole(role);
    setError('');
  };

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotStatus, setForgotStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Desktop Software Download modal state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      Boolean((window as any).electronAPI)
    );
  });

  useEffect(() => {
    const installedHandler = () => setIsInstalled(true);
    window.addEventListener('appinstalled', installedHandler);
    return () => window.removeEventListener('appinstalled', installedHandler);
  }, []);

  const handleDownloadInstaller = () => {
    window.location.href = '/api/download/desktop';
  };

  const handleDownloadApk = () => {
    window.location.href = '/api/download/android';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please provide both your email/username and password.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await api<{
        token?: string;
        user?: User;
        shop?: Shop;
        requirePasswordChange?: boolean;
        changeToken?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), identifier: email.trim(), password }),
      });

      if (data.requirePasswordChange && data.changeToken) {
        if (onRequirePasswordChange) {
          onRequirePasswordChange({
            changeToken: data.changeToken,
            tempPassword: password,
            identifier: email.trim(),
          });
        }
        return;
      }

      if (data.token && data.user && data.shop) {
        setToken(data.token);
        try {
          localStorage.setItem('user', JSON.stringify(data.user));
          localStorage.setItem('shop', JSON.stringify(data.shop));
          sessionStorage.setItem('user', JSON.stringify(data.user));
          sessionStorage.setItem('shop', JSON.stringify(data.shop));
        } catch { }
        onSuccess(data as { token: string; user: User; shop: Shop });
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid credentials. Please verify your email/username and password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotIdentifier.trim()) {
      setForgotStatus({ message: 'Please enter your username or registered email address.', isError: true });
      return;
    }

    setIsSendingReset(true);
    setForgotStatus(null);
    try {
      await api<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      setForgotStatus({
        message: 'If an account with this identifier exists, a password reset link has been dispatched to your email.',
        isError: false,
      });
    } catch (err: any) {
      setForgotStatus({
        message: err?.message || 'Unable to process password reset request at this time.',
        isError: true,
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  const roleConfig: Record<'super_admin' | 'store_manager' | 'cashier', {
    radioLabel: string;
    inputLabel: string;
    placeholder: string;
    btnText: string;
    quote: string;
    authorName: string;
    authorRole: string;
    avatarChar: string;
  }> = {
    super_admin: {
      radioLabel: 'As Admin',
      inputLabel: 'Email *',
      placeholder: 'Enter admin email',
      btnText: 'Sign in',
      quote: 'Complete visibility across your textile store, wholesale tax invoices, live inventory valuation, and daily profits—all in one clean workspace.',
      authorName: 'Admin Portal',
      authorRole: 'Store Owner & Governance',
      avatarChar: 'A',
    },
    store_manager: {
      radioLabel: 'As Manager',
      inputLabel: 'Email or Username *',
      placeholder: 'Enter manager email or username',
      btnText: 'Sign in',
      quote: 'Keep daily store operations running smoothly—monitor active billing counters, review stock levels, and reconcile register shifts effortlessly.',
      authorName: 'Manager Portal',
      authorRole: 'Store Operations & Shifts',
      avatarChar: 'M',
    },
    cashier: {
      radioLabel: 'As Cashier',
      inputLabel: 'Username or Email *',
      placeholder: 'Enter cashier username',
      btnText: 'Sign in',
      quote: 'High-speed counter billing with instant barcode scanning, quick discounts, and seamless receipt sharing for every customer.',
      authorName: 'Cashier Counter',
      authorRole: 'POS Billing Terminal',
      avatarChar: 'C',
    },
  };

  const currentRole = roleConfig[selectedRole];

  return (
    <div className={`rl-page rl-theme-${selectedRole}`}>
      <div className="rl-card">
        {/* LEFT COLUMN: Warm Cream Sign-In Form */}
        <div className="rl-left">
          <div className="rl-brand" onClick={onBackToHome} title="Surya Textiles Billing">
            <div className="rl-brand-icon">
              <StoreLogoIcon size={17} />
            </div>
            <span className="rl-brand-name">A2Z Billing</span>
          </div>

          <div className="rl-form-wrap">
            <h1 className="rl-heading">Sign In</h1>
            <p className="rl-subheading">Welcome back! Please enter your details to continue</p>

            {/* Role Radio Selector: Admin | Manager | Cashier */}
            <div className="rl-role-radios" role="radiogroup" aria-label="Select Login Role">
              {(['super_admin', 'store_manager', 'cashier'] as const).map((r) => {
                const active = selectedRole === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`rl-radio-opt ${active ? 'active' : ''}`}
                    onClick={() => handleRoleChange(r)}
                  >
                    <span className="rl-radio-dot">
                      <span className="rl-radio-dot-inner" />
                    </span>
                    <span>{roleConfig[r].radioLabel}</span>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="modern-error-banner" role="alert" style={{ marginBottom: '1rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="rl-form">
              <div className="rl-field-group">
                <label className="rl-label" htmlFor="rl-email">
                  {currentRole.inputLabel}
                </label>
                <div className="rl-input-wrap">
                  <span className="rl-input-icon">
                    {selectedRole === 'super_admin' ? <MailIcon size={16} /> : <UserIcon size={16} />}
                  </span>
                  <input
                    id="rl-email"
                    type={selectedRole === 'super_admin' ? 'email' : 'text'}
                    className="rl-input"
                    required
                    autoFocus
                    placeholder={currentRole.placeholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={selectedRole === 'cashier' ? 'username' : 'email'}
                  />
                </div>
              </div>

              <div className="rl-field-group">
                <div className="rl-label-row">
                  <label className="rl-label" htmlFor="rl-password">
                    Password *
                  </label>
                  <button
                    type="button"
                    className="rl-forgot-btn"
                    onClick={() => {
                      setForgotIdentifier(email);
                      setForgotStatus(null);
                      setShowForgotModal(true);
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="rl-input-wrap">
                  <span className="rl-input-icon">
                    <LockIcon size={16} />
                  </span>
                  <input
                    id="rl-password"
                    type={showPassword ? 'text' : 'password'}
                    className="rl-input"
                    required
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="rl-pwd-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="rl-remember-row">
                <label className="rl-remember-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
              </div>

              <button type="submit" className="rl-submit-btn" disabled={isLoading}>
                {isLoading ? 'Signing in...' : currentRole.btnText}
              </button>
            </form>
          </div>

          <div className="rl-footer-links">
            {!isInstalled && !Capacitor.isNativePlatform() && (
              <button type="button" className="rl-download-link" onClick={() => setShowDownloadModal(true)}>
                Download Desktop &amp; Mobile App
              </button>
            )}
            <span>©2026 Atriowings All rights reserved.</span>
          </div>
        </div>

        {/* RIGHT COLUMN: Pure White Editorial Quote & Custom Role Illustration */}
        <div className="rl-right">
          <div className="rl-quote-block">
            <span className="rl-quote-mark" aria-hidden="true">“</span>
            <p className="rl-quote-text">{currentRole.quote}</p>
            <span className="rl-quote-mark closing" aria-hidden="true">”</span>

            <div className="rl-author-row">
              <div className="rl-author-avatar">{currentRole.avatarChar}</div>
              <div>
                <div className="rl-author-name">{currentRole.authorName}</div>
                <div className="rl-author-sub">{currentRole.authorRole}</div>
              </div>
            </div>
          </div>

          <div className="rl-illustration-wrap">
            <RoleIllustration role={selectedRole} />
          </div>
        </div>
      </div>

      {/* Modern Forgot Password Modal */}
      {showForgotModal && (
        <div
          className="login-forgot-modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem 1rem',
            boxSizing: 'border-box',
          }}
          onClick={() => setShowForgotModal(false)}
        >
          <div
            className="login-forgot-modal-card"
            style={{
              width: '100%',
              maxWidth: '460px',
              maxHeight: 'calc(100dvh - 32px)',
              overflowY: 'auto',
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '2rem',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0F172A' }}>
                Reset Your Password
              </h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#94A3B8' }}
                onClick={() => setShowForgotModal(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B', lineHeight: '1.5' }}>
              Enter your username or registered email address. We&apos;ll send you a secure link to reset your credentials.
            </p>

            {forgotStatus && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: forgotStatus.isError ? '#FEE2E2' : '#DCFCE7',
                  color: forgotStatus.isError ? '#B91C1C' : '#15803D',
                  border: `1px solid ${forgotStatus.isError ? '#FCA5A5' : '#86EFAC'}`,
                }}
              >
                <span>{forgotStatus.isError ? '⚠️' : '✅'}</span>
                <span>{forgotStatus.message}</span>
              </div>
            )}

            <form onSubmit={handleSendForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="modern-input-group">
                <label className="modern-label" htmlFor="forgot-identifier">
                  <span>Username or Registered Email</span>
                </label>
                <input
                  id="forgot-identifier"
                  type="text"
                  className="modern-input"
                  placeholder="Enter username or email"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  required
                  style={{ paddingLeft: '1rem' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  style={{
                    background: '#F1F5F9',
                    border: 'none',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => setShowForgotModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modern-btn-submit"
                  style={{ width: 'auto', padding: '0.65rem 1.25rem', marginTop: 0 }}
                  disabled={isSendingReset}
                >
                  {isSendingReset ? 'Sending...' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern Desktop Software Download Modal */}
      {showDownloadModal && (
        <div
          className="login-download-modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem 1rem',
            boxSizing: 'border-box',
          }}
          onClick={() => setShowDownloadModal(false)}
        >
          <div
            className="login-download-modal-card"
            style={{
              width: '100%',
              maxWidth: '520px',
              background: '#FFFFFF',
              borderRadius: '24px',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              maxHeight: 'calc(100dvh - 32px)',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <img
                  src="/icon.png"
                  alt="A2Z Billing Software"
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '12px',
                    boxShadow: '0 4px 12px rgba(31, 81, 53, 0.25)',
                    objectFit: 'contain',
                  }}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    A2Z Software Download
                    <span style={{ fontSize: '0.7rem', background: '#DCFCE7', color: '#1F5135', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
                      v0.1.0
                    </span>
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                    Full Windows installer (.exe) &amp; Android mobile app (.apk)
                  </p>
                </div>
              </div>
              <button
                type="button"
                style={{
                  background: '#F1F5F9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  cursor: 'pointer',
                  color: '#64748B',
                }}
                onClick={() => setShowDownloadModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={handleDownloadInstaller}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.65rem',
                  padding: '0.9rem 1.25rem',
                  borderRadius: '14px',
                  backgroundColor: '#1F5135',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span>Download Windows Installer (.exe)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadApk}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.55rem',
                  padding: '0.7rem 1rem',
                  borderRadius: '12px',
                  background: '#F8FAFC',
                  color: '#475569',
                  border: '1.5px solid #E2E8F0',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>Download Android App (.apk)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
