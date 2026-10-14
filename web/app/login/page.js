'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchSessionQuiet, login } from '../../lib/api-client';

/** صفحه‌ی ورود — با شماره موبایل یا نام کاربری + رمز عبور */
export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchSessionQuiet().then((data) => {
      if (!alive) return;
      if (data?.authenticated) router.replace('/');
      else setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(identifier.trim(), password);
      router.replace('/');
    } catch (loginError) {
      setError(loginError?.message || 'ورود ناموفق بود.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow">
      <div className="login">
        <h1>📚 سرفصل‌یاب و داور هوشمند</h1>
        <p className="muted">برای استفاده از برنامه وارد حساب خود شوید.</p>

        <form onSubmit={submit} className="login__form">
          <div className="field">
            <label htmlFor="identifier">شماره موبایل یا نام کاربری</label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="09121234567"
              dir="ltr"
              autoComplete="username"
              required
              disabled={busy || checking}
            />
          </div>

          <div className="field">
            <label htmlFor="password">رمز عبور</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={busy || checking}
            />
          </div>

          {error ? <p className="alert alert--error">{error}</p> : null}

          <div className="actions">
            <button type="submit" className="btn btn--primary" disabled={busy || checking}>
              {checking ? '⏳ بررسی …' : busy ? '⏳ در حال ورود …' : 'ورود به برنامه'}
            </button>
          </div>
        </form>

        <p className="card__hint">
          نام کاربری، شماره موبایل و رمز عبور را مدیر از داخل «پنل ← حساب کاربری» می‌تواند تغییر دهد. برای
          اجرای محلی، مقادیر پیش‌فرض در فایل <b>README.md</b> توضیح داده شده است.
        </p>
      </div>
    </main>
  );
}
