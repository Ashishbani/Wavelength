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
      <div className="auth-panel">
        <span>Signed in as <b>{user.displayName}</b></span>
        <button onClick={() => logout()}>Log out</button>
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
    <div className="auth-panel">
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Sign up</button>
      </div>
      {mode === 'register' && (
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
      )}
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={submit} disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
