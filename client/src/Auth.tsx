import { useState } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { ApiError } from './auth/api.js';

export default function Auth({ onGuest }: { onGuest: () => void }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="auth-screen">
      <div className="auth-split">
        <div className="auth-hero">
          <div className="logo-row">
            <div className="logo-eq"><span /><span /><span /><span /></div>
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
            <div className="auth-tabs">
              <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
              <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Sign up</button>
            </div>
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
            <p className="muted switch-hint">
              {mode === 'login' ? "New here? " : 'Already have an account? '}
              <button className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
                {mode === 'login' ? 'Create an account' : 'Log in'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
