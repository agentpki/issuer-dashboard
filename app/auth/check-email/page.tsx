type Status = 'new' | 'resent' | undefined;

export default async function CheckEmail({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const s = (status === 'new' || status === 'resent' ? status : undefined) as Status;

  const heading =
    s === 'resent'
      ? 'Welcome back — fresh sign-in link sent'
      : s === 'new'
      ? "Welcome — let's create your account"
      : 'Check your inbox';

  const body =
    s === 'resent'
      ? "We've already got an account on file for that email. We just sent a fresh one-time sign-in link to your inbox."
      : s === 'new'
      ? "We sent a one-time sign-in link to your inbox. Click it to finish creating your account."
      : 'We sent you a one-time sign-in link. The link expires in 24 hours and can only be used once.';

  return (
    <div className="container" style={{ paddingTop: '4rem', maxWidth: '32rem' }}>
      <h1>{heading}</h1>
      <p className="muted">{body}</p>
      <p className="dim" style={{ marginTop: '1rem' }}>
        Link expires in 24 hours · single use.
      </p>
      <p className="dim" style={{ marginTop: '2rem' }}>
        Not arriving? Check <strong>Spam</strong>, <strong>Promotions</strong>, and{' '}
        <strong>All Mail</strong>. Still nothing within 2 minutes? Email{' '}
        <a href="mailto:hello@agentpki.dev">hello@agentpki.dev</a>.
      </p>
    </div>
  );
}
