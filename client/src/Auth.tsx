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
      // On success the auth user is set and the app moves to the lobby.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing auth-screen">
      <div className="brand">
        <div className="logo-row">
          <div className="logo-eq"><span /><span /><span /><span /></div>
          <h1 className="wordmark">Wavelength</h1>
        </div>
        <p className="tagline">Listen together, in perfect sync.</p>
      </div>

      <div className="card panel auth-form">
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Sign up</button>
        </div>

        {mode === 'register' && (
          <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        )}
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <button className="primary" onClick={submit} disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="divider">or</div>
      <button className="guest-btn" onClick={onGuest}>Continue as guest →</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
        Guests can create and join rooms. Sign in to save rooms, playlists, and add friends.
      </p>

      <div className="features">
        <div className="feat"><span className="ico">🎧</span><b>Synced playback</b><small>Everyone hears the same moment</small></div>
        <div className="feat"><span className="ico">📃</span><b>Shared queue</b><small>Anyone can line up the next track</small></div>
        <div className="feat"><span className="ico">💬</span><b>Live chat</b><small>React together in real time</small></div>
        <div className="feat"><span className="ico">👥</span><b>Friends &amp; presence</b><small>See who's online, hop in</small></div>
      </div>
    </div>
  );
}
