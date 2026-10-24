import { signIn } from './actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 420, margin: '12vh auto 0' }} className="stack">
      <div className="brand"><div className="mark" aria-hidden="true">P</div><div><h1>Parakkat</h1><small>AI marketing office · Jewels</small></div></div>
      <form action={signIn} className="card stack">
        <h2 style={{ fontSize: 20 }}>Sign in</h2>
        {sp.error && <p className="flash">{sp.error}</p>}
        {sp.sent && <p className="note">Check your email for a sign-in link.</p>}
        <label className="field">Work email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="current-password" /></label>
        <button className="btn" type="submit">Sign in</button>
        <p className="note">Leave the password empty to get a one-time sign-in link by email. Accounts are created by the Super Admin.</p>
      </form>
    </div>
  );
}
