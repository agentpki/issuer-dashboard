export default function CheckEmail() {
  return (
    <div className="container" style={{ paddingTop: '4rem', maxWidth: '32rem' }}>
      <h1>Check your inbox</h1>
      <p className="muted">
        We sent you a one-time sign-in link. The link expires in 24 hours and can only be used once.
      </p>
      <p className="dim" style={{ marginTop: '2rem' }}>
        If it doesn't arrive within a minute, check your spam folder. Still nothing? Email{' '}
        <a href="mailto:hello@agentpki.dev">hello@agentpki.dev</a>.
      </p>
    </div>
  );
}
