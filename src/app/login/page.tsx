import { signIn } from './actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="workspace login-page">
      <div className="wordmark login-brand"><b>PARAKKAT</b><small>AI OFFICE</small></div>
      <form action={signIn} className="card stack">
        <div className="login-heading"><h1>Sign in to your workspace</h1><p>Manage your team, designs and business performance.</p></div>
        {sp.error && <p className="flash" role="alert">{sp.error}</p>}
        {sp.sent && <p className="flash ok" role="status">Check your email for a sign-in link.</p>}
        <label className="field">Work email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password <span className="login-optional">Optional for email sign-in</span><input name="password" type="password" autoComplete="current-password" aria-describedby="login-help" /></label>
        <button className="btn" type="submit">Sign in</button>
        <p className="note" id="login-help">Leave the password empty to get a one-time sign-in link by email. Accounts are created by the Super Admin.</p>
      </form>
    </main>
  );
}
