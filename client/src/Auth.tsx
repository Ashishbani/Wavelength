import { useState } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { EqBars } from './room/icons.js';
import { ApiError, apiPost } from './auth/api.js';

type Mode = 'login' | 'register' | 'forgot';

export default function Auth({ onGuest }: { onGuest: () => void }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Switching between Log in / Sign up / Forgot starts from a clean form —
  // fields must not carry over between modes.
  function switchMode(next: Mode) {
    setMode(next);
    setEmail(''); setPassword(''); setDisplayName(''); setCode('');
    setCodeSent(false); setError(''); setNotice('');
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await apiPost<{ message?: string }>('/api/auth/forgot', { email });
      setCodeSent(true);
      setNotice(r.message ?? 'Check your inbox for a 6-digit code.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiPost('/api/auth/reset', { email, code: code.trim(), newPassword: password });
      // The password is changed — sign straight in with it.
      await login(email, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-split">
        <div className="auth-hero">
          <div className="logo-row">
            <EqBars className="logo-eq" />
            <h1 className="wordmark">Wavelength</h1>
          </div>
          <p className="hero-tag">Listen to the same song, at the same moment, with anyone — anywhere.</p>
          <ul className="hero-features">
            <li><span className="ico">🎧</span><div><b>Synced playback</b><small>Everyone hears the same beat, in perfect sync.</small></div></li>
            <li><span className="ico">📃</span><div><b>Shared queue & voting</b><small>Anyone can add tracks — the room votes what plays next.</small></div></li>
            <li><span className="ico">💬</span><div><b>Live chat & reactions</b><small>Talk and drop 🔥❤️🎉 as the music plays.</small></div></li>
            <li><span className="ico">👥</span><div><b>Friends & rooms</b><small>See who's online and drop into their room.</small></div></li>
          </ul>
          <button className="guest-btn" onClick={onGuest}>Continue as guest →</button>
          <p className="muted" style={{ marginTop: 10 }}>No account needed to create or join a room.</p>
        </div>

        <div className="auth-form-wrap">
          <div className="card panel auth-form">
            {mode !== 'forgot' && (
              <div className="auth-tabs">
                <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Log in</button>
                <button className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Sign up</button>
              </div>
            )}

            {mode === 'forgot' ? (
              <>
                <p className="form-lead">Reset your password</p>
                <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !codeSent) sendCode(); }} />
                {!codeSent ? (
                  <button className="primary" onClick={sendCode} disabled={busy || !email}>
                    {busy ? 'Sending…' : 'Email me a code'}
                  </button>
                ) : (
                  <>
                    <input placeholder="6-digit code" inputMode="numeric" maxLength={6}
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                    <input placeholder="New password (8+ characters)" type="password" autoComplete="new-password"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') resetPassword(); }} />
                    <button className="primary" onClick={resetPassword} disabled={busy || code.length !== 6 || password.length < 8}>
                      {busy ? 'Resetting…' : 'Reset password & log in'}
                    </button>
                    <p className="muted switch-hint">
                      Didn't get it? <button className="link" onClick={sendCode} disabled={busy}>Send a new code</button>
                    </p>
                  </>
                )}
                {notice && <p className="muted pw-ok">{notice}</p>}
                {error && <p className="error">{error}</p>}
                <p className="muted switch-hint">
                  <button className="link" onClick={() => switchMode('login')}>← Back to log in</button>
                </p>
              </>
            ) : (
              <>
                <p className="form-lead">{mode === 'login' ? 'Welcome back.' : 'Create your account'}</p>
                {mode === 'register' && (
                  <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
                )}
                <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
                <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
                <button className="primary" onClick={submit} disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
                {error && <p className="error">{error}</p>}
                {mode === 'login' && (
                  <p className="muted switch-hint">
                    <button className="link" onClick={() => switchMode('forgot')}>Forgot password?</button>
                  </p>
                )}
                <p className="muted switch-hint">
                  {mode === 'login' ? 'New here? ' : 'Already have an account? '}
                  <button className="link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
                    {mode === 'login' ? 'Create an account' : 'Log in'}
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
