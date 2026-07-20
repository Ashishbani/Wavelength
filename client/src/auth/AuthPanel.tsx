import { useState } from 'react';
import { useAuth } from './AuthContext.js';
import { ApiError } from './api.js';

export default function AuthPanel() {
  const { user, login, register, logout } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <div className="card auth-panel signed">
        <span className="row" style={{ background: 'transparent', padding: 0, gap: 10 }}>
          <span className="avatar sm" style={{ background: '#8b5cff' }}>{user.displayName.slice(0, 2).toUpperCase()}</span>
          <span>Signed in as <b>{user.displayName}</b>{user.username ? <small> @{user.username}</small> : null}</span>
        </span>
        <button className="ghost" onClick={() => logout()}>Log out</button>
      </div>
    );
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

  return (
    <div className="card auth-panel">
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Sign up</button>
      </div>
      {mode === 'register' && (
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
      )}
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="primary" onClick={submit} disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
