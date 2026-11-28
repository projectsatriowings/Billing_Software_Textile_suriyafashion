import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { api, setToken, type User, type Shop } from '../api';
import './auth/modernLogin.css';

// Crisp inline SVG Icons to eliminate all unicode emojis
const CrownIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
    <path d="M3 20h18" strokeWidth="2.4" />
  </svg>
);

const StoreIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const CashierIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <line x1="6" y1="15" x2="10" y2="15" />
    <line x1="14" y1="15" x2="18" y2="15" />
  </svg>
);

const LightningBoltIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const MailIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const UserIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LockIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const ShieldLockIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ArrowRightIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const RoleIcon: React.FC<{ role: string; size?: number; className?: string }> = ({ role, size = 16, className = '' }) => {
  if (role === 'super-admin' || role === 'super_admin') return <CrownIcon size={size} className={className} />;
  if (role === 'store-manager' || role === 'store_manager') return <StoreIcon size={size} className={className} />;
  return <CashierIcon size={size} className={className} />;
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
  onNavigateRegister,
  onBackToHome,
  onRequirePasswordChange,
}) => {
  const detectInitialRole = (): 'super_admin' | 'store_manager' | 'cashier' | 'cashier2' => {
    const isSmDisabled = typeof window !== 'undefined' && localStorage.getItem('feature_store_manager_enabled') === 'false';
    if (initialRole) {
      if (initialRole === 'store_manager' && isSmDisabled) return 'super_admin';
      return initialRole as any;
    }
    try {
      const hash = (typeof window !== 'undefined' ? window.location.hash : '').toLowerCase();
      const search = (typeof window !== 'undefined' ? window.location.search : '').toLowerCase();
      if (hash.includes('cashier2') || search.includes('cashier2')) return 'cashier2';
      if (hash.includes('cashier') || search.includes('cashier')) return 'cashier';
      if (!isSmDisabled && (hash.includes('manager') || search.includes('manager'))) return 'store_manager';
    } catch { }
    return 'super_admin';
  };

  const [selectedRole, setSelectedRole] = useState<'super_admin' | 'store_manager' | 'cashier' | 'cashier2'>(detectInitialRole);
  const [isStoreManagerEnabled, setIsStoreManagerEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('feature_store_manager_enabled');
      if (stored !== null) return stored === 'true';
    }
    return true;
  });

  useEffect(() => {
    let active = true;
    api<{ success: boolean; storeManagerEnabled: boolean }>('/api/auth/features')
      .then((res) => {
        if (active && res && typeof res.storeManagerEnabled === 'boolean') {
          setIsStoreManagerEnabled(res.storeManagerEnabled);
          localStorage.setItem('feature_store_manager_enabled', String(res.storeManagerEnabled));
          if (!res.storeManagerEnabled && selectedRole === 'store_manager') {
            setSelectedRole('super_admin');
            setEmail('demo@billing.local');
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedRole]);
  const [email, setEmail] = useState(() => {
    const role = detectInitialRole();
    if (role === 'cashier') return 'cashier@billing.local';
    if (role === 'cashier2') return 'lakshmi@billing.local';
    if (role === 'store_manager') return 'manager@billing.local';
    return 'demo@billing.local';
  });
  const [password, setPassword] = useState('Password123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRoleTabChange = (role: 'super_admin' | 'store_manager' | 'cashier' | 'cashier2') => {
    setSelectedRole(role);
    setError('');
    if (role === 'super_admin') {
      setEmail('demo@billing.local');
      setPassword('Password123!');
    } else if (role === 'store_manager') {
      setEmail('manager@billing.local');
      setPassword('Password123!');
    } else if (role === 'cashier2') {
      setEmail('lakshmi@billing.local');
      setPassword('Password123!');
    } else {
      setEmail('cashier@billing.local');
      setPassword('Password123!');
    }
  };

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotStatus, setForgotStatus] = useState<{ message: string; isError?: boolean } | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Desktop App Installer & PWA
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      Boolean((window as any).electronAPI)
    );
  });

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    const installedHandler = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleDownloadInstaller = () => {
    window.location.href = '/api/download/desktop';
  };

  const handleDownloadApk = () => {
    window.location.href = '/api/download/android';
  };

  const handleInstallApp = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setIsInstalled(true);
        setInstallPrompt(null);
      }
    } else {
      alert(
        "To install A2Z as a Desktop App on your PC:\n\n" +
        "1. In Chrome or Edge, look at the URL address bar at the top.\n" +
        "2. Click the 'Install App' icon (or click Menu ⋮ → 'Install A2Z Billing').\n" +
        "3. Click 'Install' — A2Z will be added directly to your Desktop and Start Menu with zero Windows warnings!"
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please provide both your email and password.');
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
      setError(err?.message || 'Invalid email or password. Please verify your credentials.');
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
        message: "If an account with this identifier exists, a password reset link has been dispatched to your email.",
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

  const isCashier = selectedRole === 'cashier' || selectedRole === 'cashier2';
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const roleMeta: Record<string, {
    key: string;
    image: string | null;
    title: string;
    subtitle: string;
    heroTitle: string;
    heroSubtitle: string;
    inputLabel: string;
    placeholder: string;
    btnText: string;
    badge: string;
    securityTag: string;
    loginQuote: string;
  }> = {
    super_admin: {
      key: 'super-admin',
      image: '/images/admin.png?v=20261120_v4',
      title: 'Super Admin Portal',
      subtitle: 'Enterprise headquarters: consolidated sales, multi-branch network & governance.',
      heroTitle: 'Consolidated Enterprise Control.',
      heroSubtitle: 'Manage headquarters sales, branch inventory and company governance all in one real-time workspace.',
      inputLabel: 'Super Admin Email',
      placeholder: 'demo@billing.local',
      btnText: 'Log In as Super Admin',
      badge: 'HQ Super Admin',
      securityTag: 'HQ Executive Clearance',
      loginQuote: 'Track enterprise growth, oversee branches, and analyze performance!',
    },
    store_manager: {
      key: 'store-manager',
      image: '/images/manager.png?v=20261120_v4',
      title: 'Store Manager Portal',
      subtitle: 'Branch operations: register closing approvals, cash float audits & staff supervision.',
      heroTitle: 'Keep In Touch With Your Store.',
      heroSubtitle: 'Monitor live cashier counters, balance register floats, and approve daily shift audits seamlessly.',
      inputLabel: 'Store Manager Username or Email',
      placeholder: 'manager@billing.local',
      btnText: 'Log In as Store Manager',
      badge: 'Store Manager',
      securityTag: 'Branch Operations Clearance',
      loginQuote: 'Manage daily store operations, track sales, and supervise shifts!',
    },
    cashier: {
      key: 'cashier',
      image: '/images/cashier.png?v=20261120_v4',
      title: 'Cashier Billing Counter',
      subtitle: 'High-speed retail checkout, cash drawer shift balancing & rapid barcode billing.',
      heroTitle: 'High-Speed Cashier POS.',
      heroSubtitle: 'Instant barcode scanning, customer-facing display sync & offline transaction buffering.',
      inputLabel: 'Cashier Employee ID or Email',
      placeholder: 'cashier@billing.local',
      btnText: selectedRole === 'cashier2' ? 'Log In as Cashier 2 (Lakshmi)' : 'Log In as Cashier',
      badge: 'Cashier Station',
      securityTag: 'POS Register Terminal',
      loginQuote: 'Start your shift and serve customers with fast, seamless billing!',
    },
  };

  const currentMeta = isCashier
    ? roleMeta.cashier
    : selectedRole === 'store_manager'
      ? roleMeta.store_manager
      : roleMeta.super_admin;

  return (
    <div className="modern-login-page">
      <div className={`modern-login-card role-${currentMeta.key}`}>
        {/* ------------------------------------------------------------------
            LEFT HALF: USER'S GENERATED IMAGE DISPLAY / BRANDING
            ------------------------------------------------------------------ */}
        {(() => {
          const isSuperAdmin = currentMeta.key === 'super-admin';
          const isCashierRole = currentMeta.key === 'cashier';
          const isStoreManager = currentMeta.key === 'store-manager';
          const isHeroLayout = isSuperAdmin || isCashierRole || isStoreManager;
          const hasImage = Boolean(currentMeta.image && !failedImages[currentMeta.image]);

          if (isHeroLayout) {
            const roleLayoutClass = isSuperAdmin
              ? 'super-admin-layout'
              : isCashierRole
                ? 'cashier-layout'
                : 'store-manager-layout';

            return (
              <div className={`modern-login-left ${roleLayoutClass}`}>
                <div className="modern-login-top-wordings">
                  <div className="modern-left-badge">
                    <RoleIcon role={currentMeta.key} size={15} />
                    <span>{currentMeta.badge}</span>
                  </div>
                  <h1 className="modern-left-heading">{currentMeta.heroTitle}</h1>
                </div>

                {hasImage && currentMeta.image && (
                  <div className="modern-admin-illustration-area">
                    <img
                      key={currentMeta.image}
                      src={currentMeta.image}
                      alt={`${currentMeta.title} Illustration`}
                      className="modern-admin-hero-img"
                      onError={() => {
                        setFailedImages((prev) => ({ ...prev, [currentMeta.image!]: true }));
                      }}
                    />
                  </div>
                )}
              </div>
            );
          }

          return (
            <div className={`modern-login-left ${hasImage ? 'has-image' : 'text-only-layout'}`}>
              {hasImage && currentMeta.image ? (
                <img
                  key={currentMeta.image}
                  src={currentMeta.image}
                  alt={`${currentMeta.title} Illustration`}
                  className="user-login-image"
                  onError={() => {
                    setFailedImages((prev) => ({ ...prev, [currentMeta.image!]: true }));
                  }}
                />
              ) : (
                <div className="modern-login-top-wordings">
                  <div className="modern-left-badge">
                    <RoleIcon role={currentMeta.key} size={15} />
                    <span>{currentMeta.badge}</span>
                  </div>
                  <h1 className="modern-left-heading">{currentMeta.heroTitle}</h1>
                  <p className="modern-left-subtitle">{currentMeta.heroSubtitle}</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* ------------------------------------------------------------------
            RIGHT HALF: CLEAN MINIMALIST LOGIN FORM (Matching Reference Design)
            ------------------------------------------------------------------ */}
        <div className="modern-login-right">
          <div className="felix-login-container">
            {/* Top Row: Brand Mark & Role Switcher */}
            <div className="felix-top-nav">
              <div className="felix-brand-mark" onClick={onBackToHome} title="Adaptive Billing">
                <LightningBoltIcon size={38} className="felix-bolt-icon" />
              </div>

              {/* Minimal Pill Role Tabs */}
              <div className="felix-role-tabs-strip">
                <button
                  type="button"
                  className={`felix-role-pill ${selectedRole === 'super_admin' ? 'active' : ''}`}
                  onClick={() => handleRoleTabChange('super_admin')}
                >
                  <CrownIcon size={13} />
                  <span className="role-pill-full">Super Admin</span>
                  <span className="role-pill-short">Admin</span>
                </button>
                {isStoreManagerEnabled && (
                  <button
                    type="button"
                    className={`felix-role-pill ${selectedRole === 'store_manager' ? 'active' : ''}`}
                    onClick={() => handleRoleTabChange('store_manager')}
                  >
                    <StoreIcon size={13} />
                    <span className="role-pill-full">Store Manager</span>
                    <span className="role-pill-short">Manager</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`felix-role-pill ${isCashier ? 'active' : ''}`}
                  onClick={() => handleRoleTabChange('cashier')}
                >
                  <CashierIcon size={13} />
                  <span className="role-pill-full">Cashier Counter</span>
                  <span className="role-pill-short">Cashier</span>
                </button>
              </div>
            </div>

            {/* Title & Subtitle Matching Screenshot */}
            <div className="felix-heading-block">
              <h1 className="felix-title">Login</h1>
              <p className="felix-subtitle">{currentMeta.loginQuote}</p>
            </div>

            {error && (
              <div className="modern-error-banner" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Main Form Matching Screenshot */}
            <form onSubmit={handleSubmit} className="felix-auth-form">
              <div className="felix-input-group">
                <label className="felix-label" htmlFor="felix-email">
                  Email*
                </label>
                <input
                  id="felix-email"
                  type={selectedRole === 'super_admin' ? 'email' : 'text'}
                  className="felix-input"
                  required
                  autoFocus
                  placeholder="mail@website.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete={isCashier ? 'username' : 'email'}
                />
              </div>

              <div className="felix-input-group">
                <label className="felix-label" htmlFor="felix-password">
                  Password*
                </label>
                <div className="felix-input-relative">
                  <input
                    id="felix-password"
                    type={showPassword ? 'text' : 'password'}
                    className="felix-input"
                    required
                    placeholder="Min. 8 character"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="felix-pwd-toggle"
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

              <div className="felix-options-row">
                <label className="felix-checkbox-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  className="felix-forgot-link"
                  onClick={() => {
                    setForgotIdentifier(email);
                    setForgotStatus(null);
                    setShowForgotModal(true);
                  }}
                >
                  Forget password?
                </button>
              </div>

              <button
                type="submit"
                className="felix-btn-submit"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="btn-loading-flex">
                    <svg className="spin-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    <span>Logging in...</span>
                  </span>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            {!isInstalled && !Capacitor.isNativePlatform() && (
              <button
                type="button"
                onClick={() => setShowDownloadModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.65rem',
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)',
                  border: '1.5px solid #D8B4FE',
                  color: '#6B21A8',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  marginTop: '0.85rem',
                  boxShadow: '0 2px 8px rgba(107, 33, 168, 0.08)',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)';
                  e.currentTarget.style.borderColor = '#C084FC';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(107, 33, 168, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)';
                  e.currentTarget.style.borderColor = '#D8B4FE';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(107, 33, 168, 0.08)';
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', lineHeight: 1.25 }}>
                  <span style={{ fontWeight: 800 }}>Download A2Z </span>
                  <span style={{ fontSize: '0.72rem', color: 'black', fontWeight: 500 }}>Setup Wizard • Choose Install Location</span>
                </div>
              </button>
            )}

            {/* Footer Copyright */}
            <div className="felix-copyright">
              ©2026 Atriowings All rights reserved.
            </div>
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
              Enter your username or registered email address. We'll send you a secure link to reset your credentials.
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
                  required
                  placeholder="e.g. manager@billing.local or demo@billing.local"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
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
            {/* Header with Official Logo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <img
                  src="/icon.png"
                  alt="A2Z Billing Software"
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '12px',
                    boxShadow: '0 4px 12px rgba(109, 40, 217, 0.3)',
                    objectFit: 'contain',
                  }}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    A2Z Software Download
                    <span style={{ fontSize: '0.7rem', background: '#EDE9FE', color: '#352737', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
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

            {/* Direct Download Buttons */}
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
                  backgroundColor: '#352737',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(109, 40, 217, 0.35)',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(109, 40, 217, 0.45)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 18px rgba(109, 40, 217, 0.35)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Windows Installer (.exe)</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.85, fontWeight: 500 }}>(122 MB)</span>
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
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F1F5F9';
                  e.currentTarget.style.borderColor = '#CBD5E1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#F8FAFC';
                  e.currentTarget.style.borderColor = '#E2E8F0';
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#059669', flexShrink: 0 }}>
                  <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v6c0 .83.67 1.5 1.5 1.5S5 16.33 5 15.5v-6C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v6c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-6c0-.83-.67-1.5-1.5-1.5zm-4.97-4.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.68 2.24 12.87 2 12 2c-.87 0-1.68.24-2.64.63L7.88 1.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C6.72 4.18 5.5 5.94 5.5 8h13c0-2.06-1.22-3.82-2.97-4.84zM9 6c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" />
                </svg>
                <span>Download Android App (.apk)</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.75, fontWeight: 500 }}>(16 MB)</span>
              </button>
            </div>

            {/* Quick 3-Step Setup Guide */}
            <div style={{ background: '#F8FAFC', borderRadius: '14px', padding: '1rem', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Setup &amp; Installation Steps
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', fontSize: '0.82rem', color: '#475569', lineHeight: 1.45 }}>
                <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#352737', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, flexShrink: 0, marginTop: '1px' }}>1</span>
                <div><strong>Windows (.exe):</strong> Double-click <strong>A2Z Setup 0.1.0.exe</strong> after download completes and follow the setup wizard.</div>
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', fontSize: '0.82rem', color: '#475569', lineHeight: 1.45 }}>
                <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#352737', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, flexShrink: 0, marginTop: '1px' }}>2</span>
                <div><strong>Android (.apk):</strong> Open <strong>A2Z-Billing.apk</strong> on your device, enable <em>"Install unknown apps"</em> when prompted, and tap <strong>Install</strong>.</div>
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', fontSize: '0.82rem', color: '#475569', lineHeight: 1.45 }}>
                <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#352737', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, flexShrink: 0, marginTop: '1px' }}>3</span>
                <div>Launch the official <strong>A2Z shortcut</strong> on your Desktop or Android Home Screen to begin billing!</div>
              </div>
            </div>

            {/* SmartScreen / Unknown Apps Helper */}
            <div style={{ background: '#FFFBEB', borderRadius: '14px', padding: '0.85rem 1rem', border: '1px solid #FDE68A', display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1.1rem', marginTop: '1px' }}>💡</span>
              <div style={{ fontSize: '0.78rem', color: '#92400E', lineHeight: 1.45 }}>
                <strong>Installation Tips:</strong>
                <div style={{ marginTop: '3px' }}>
                  <strong>Windows:</strong> If SmartScreen appears, click <em>"More info"</em> → <strong>"Run anyway"</strong>.<br />
                  <strong>Android:</strong> Allow Chrome or Files to <em>"Install unknown apps"</em> in device Settings when prompted.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
