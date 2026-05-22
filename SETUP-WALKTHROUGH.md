# Issuer dashboard — step-by-step setup walkthrough

Follow this top-to-bottom. Each numbered step is one thing. Total time: ~45 min if you don't already have accounts at Neon / Resend / Vercel; ~15 min if you do.

---

## What you're building

A live website at **dashboard.agentpki.dev** where:
- You sign in with email (magic link, no password)
- You add a domain you own (e.g., `your-co.com`)
- The dashboard checks DNS to verify you own it
- It generates a signing key for you
- You download the config to deploy at your own domain

---

## Part 0 — generate two random secrets (1 minute)

You'll need these for env vars later. Generate them now and save somewhere safe (password manager).

Open PowerShell and run **each line by itself**, copy the output of each into a safe place:

```powershell
# Run line 1 — save output as NEXTAUTH_SECRET
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# Run line 2 — save output as KEY_ENCRYPTION_KEY
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

You'll see two long strings ending with `=`. Label them clearly:

```
NEXTAUTH_SECRET     = "Aq...random...="
KEY_ENCRYPTION_KEY  = "Bp...random...="
```

> **`KEY_ENCRYPTION_KEY` is irreplaceable.** If you lose it, every signing key stored in your dashboard becomes unrecoverable. Save it in 1Password / Bitwarden / a sealed envelope before continuing.

---

## Part 1 — Neon (Postgres database) · ~5 min

### 1.1 — Sign up
- Open **https://console.neon.tech**
- Click **Sign up** → use GitHub (you already have an account there)
- Approve any GitHub permissions Neon asks for
- You'll land on the Neon console

### 1.2 — Create your project
- Click **Create a project** (big button on the landing console page)
- Project name: `agentpki-dashboard`
- Postgres version: leave default (16 or 17, whichever)
- Region: pick the one closest to you (US East / EU / etc.)
- Click **Create project**

### 1.3 — Copy the connection string
- After creation, Neon shows a "Connection Details" panel
- You'll see two connection strings: **Pooled** and **Unpooled**
- **Copy the POOLED connection string** (it has `-pooler` in the hostname)
- It looks like: `postgres://neondb_owner:password@ep-XXX-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`
- Save this as `DATABASE_URL` somewhere safe

If you closed that panel:
- Click **Dashboard** in the left sidebar
- Click your project (`agentpki-dashboard`)
- Click **Connection Details**
- Toggle **Pooled connection** ON
- Click the copy icon next to the connection string

---

## Part 2 — Resend (sends sign-in emails) · ~7 min

### 2.1 — Sign up
- Open **https://resend.com**
- Click **Sign up** in the top-right
- Use GitHub auth (easiest) or email
- Complete the signup flow

### 2.2 — Add and verify the `agentpki.dev` domain
- In the Resend dashboard, left sidebar → click **Domains**
- Click **Add Domain** (top-right blue button)
- Domain: type `agentpki.dev`
- Region: pick the same region you chose for Neon if possible
- Click **Add**

### 2.3 — Add DNS records to Cloudflare
Resend will show you 3-4 DNS records to add (MX, TXT for SPF, CNAME for DKIM, optionally TXT for DMARC).

- In a new tab, open **https://dash.cloudflare.com**
- Left sidebar → **Websites** → click `agentpki.dev`
- Left sidebar → **DNS** → **Records**
- For each Resend record:
  - Click **Add record**
  - Pick the Type from the dropdown (TXT or CNAME or MX)
  - Name: paste from Resend (will be something like `send` or `resend._domainkey` — paste **exactly** what Resend shows, NOT the full `send.agentpki.dev`)
  - Content / Target: paste the value from Resend
  - For TXT records: **DO NOT** quote the content; CF adds quotes automatically
  - **Proxy status**: set to "DNS only" (the grey cloud, NOT orange). Important for email DNS.
  - Click **Save**

Repeat for each row Resend showed you (usually 3 records).

### 2.4 — Verify in Resend
- Back in Resend's domain page, click **Verify DNS records**
- Wait 30 sec — 5 min for propagation (refresh if it doesn't immediately go green)
- All records should show **Verified** with a green check

### 2.5 — Generate API key
- Resend left sidebar → **API Keys**
- Click **Create API Key**
- Name: `agentpki-dashboard`
- Permission: **Sending access** (NOT full access — least privilege)
- Domain: select `agentpki.dev`
- Click **Add**
- **COPY THE KEY IMMEDIATELY** — starts with `re_...`
- Save as `RESEND_API_KEY`

> Resend will only show this key once. If you close the modal, you'll have to delete it and create a new one.

### 2.6 — Side benefit: send-as hello@agentpki.dev
With the domain verified in Resend, you can now ALSO send mail from `hello@agentpki.dev` via Gmail's "Send mail as" feature:

- Gmail → Settings (gear icon) → See all settings → **Accounts and Import** tab
- "Send mail as" → **Add another email address**
- Name: `AgentPKI`
- Email: `hello@agentpki.dev`
- Treat as alias: leave checked
- Click **Next Step**
- SMTP server: `smtp.resend.com`, Port: `465`
- Username: `resend`
- Password: paste the API key from step 2.5 (`re_...`)
- Connection: **SSL**
- Click **Add Account**

Resend emails a confirmation code to `hello@agentpki.dev`. Since you set up Cloudflare Email Routing earlier, the code lands in your real inbox. Paste it into Gmail → done.

That's also task #9 (Resend send-as) ticked off as a side-effect.

---

## Part 3 — Vercel (deploys the website) · ~5 min

### 3.1 — Sign up
- Open **https://vercel.com**
- Click **Sign up**
- Use GitHub auth (same account)
- Approve any permissions

### 3.2 — Import the dashboard repo
- On the Vercel dashboard, click **Add New...** → **Project**
- You'll see a list of your GitHub repos
- Find **`agentpki/issuer-dashboard`** in the list (use the search box if needed)
- Click **Import**

### 3.3 — Configure the project
A configuration screen appears:

- **Project Name**: leave as `issuer-dashboard` (or rename to `agentpki-dashboard`)
- **Framework Preset**: Vercel auto-detects "Next.js" — leave as is
- **Root Directory**: leave as `./`
- **Build and Output Settings**: leave defaults
- **Environment Variables**: click to expand this section, then add the following one by one:

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooled Neon connection string from Part 1.3 |
| `NEXTAUTH_SECRET` | the first random string from Part 0 |
| `NEXTAUTH_URL` | `https://issuer-dashboard.vercel.app` (you'll change this later) |
| `RESEND_API_KEY` | the `re_...` key from Part 2.5 |
| `EMAIL_FROM` | `hello@agentpki.dev` |
| `KEY_ENCRYPTION_KEY` | the second random string from Part 0 |

For each row: type the name in the left input, paste the value in the right, click **Add**.

### 3.4 — Deploy
- Click the big **Deploy** button at the bottom
- Wait ~2 min while Vercel builds
- You should see green checkmarks for "Building", "Deploying", etc.
- When done, Vercel shows confetti and a live URL like `https://issuer-dashboard-abc123.vercel.app`
- Click **Visit** to open your live dashboard

### 3.5 — Push the database schema
The dashboard is live but the database is empty. We need to create the 8 tables.

In PowerShell:

```powershell
cd C:\Users\User\agentpki\issuer-dashboard

# Set DATABASE_URL just for this command
$env:DATABASE_URL = "paste-the-neon-connection-string-here"

# Push the schema
pnpm db:push
```

You'll see Drizzle list 8 tables it's about to create. Type `y` to confirm.

Done — your Neon DB now has the schema, your Vercel site is talking to it.

### 3.6 — Test sign-in
- Visit your Vercel URL
- Enter your email
- Click **Send magic link**
- Check your inbox (the same inbox `hello@agentpki.dev` forwards to)
- The email comes from Resend, "from" address `hello@agentpki.dev` — click the magic link
- You're now signed in at the dashboard

---

## Part 4 — attach `dashboard.agentpki.dev` (custom domain) · ~3 min

The landing page on `agentpki.dev` now links to `https://dashboard.agentpki.dev`. Let's make that real.

### 4.1 — Add the domain in Vercel
- In your Vercel project, top tab → **Settings** → **Domains** (left sidebar)
- Input: type `dashboard.agentpki.dev`
- Click **Add**
- Vercel shows DNS records you need to add at Cloudflare (typically one CNAME)

### 4.2 — Add CNAME at Cloudflare
- **https://dash.cloudflare.com** → **Websites** → `agentpki.dev` → **DNS** → **Records**
- Click **Add record**
- Type: **CNAME**
- Name: `dashboard`
- Target: paste from Vercel (looks like `cname.vercel-dns.com` or similar)
- **Proxy status**: set to **DNS only** (grey cloud). Vercel handles SSL; CF proxy interferes.
- Save

### 4.3 — Verify
- Back in Vercel → Settings → Domains
- Vercel auto-detects the DNS and switches to "Valid Configuration" within ~30 seconds
- SSL provisions in another ~30 seconds
- Test: visit `https://dashboard.agentpki.dev` — should redirect to the dashboard

### 4.4 — Update Vercel env var
- Vercel → Settings → **Environment Variables**
- Edit `NEXTAUTH_URL` → change to `https://dashboard.agentpki.dev`
- **Redeploy**: Settings → Deployments → click the latest → ⋯ menu → **Redeploy**

That's it. The dashboard is live at the brand domain.

---

## Part 5 — dogfood it · ~3 min

Go to `https://dashboard.agentpki.dev`, sign in with your email, then:

1. Click **New issuer**
2. Domain: `agentpki.dev` (or any domain you own)
3. Display name: `AgentPKI`
4. Tier: T1 (default)
5. Click **Register issuer**
6. You'll see a TXT record challenge — add it to Cloudflare DNS
7. Click **Verify now** — should turn green
8. Click **Generate first signing key**
9. You now have your first real AgentPKI issuer config — copy the values into the [real-issuer Worker](https://github.com/agentpki/real-issuer) to actually serve passports at the domain

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Resend says "DNS not verified" after 10 min | Make sure all records are set to "DNS only" (grey cloud) at Cloudflare, not "Proxied" (orange) |
| Vercel build fails with "module not found" | Check Settings → General → Node.js Version is set to **20.x** or **22.x** |
| Magic link email doesn't arrive | Check the FROM address in Resend matches `EMAIL_FROM` env var exactly. Also check spam folder. |
| Sign-in works but "User not found" error after | Run `pnpm db:push` again — tables didn't get created the first time |
| `dashboard.agentpki.dev` returns 404 | Wait full 5 min for SSL. If still 404, in Vercel re-add the domain. |
| "KEY_ENCRYPTION_KEY must decode to 32 bytes" | Your base64 string is wrong length. Re-generate from Part 0. Must be **exactly** the output of the PowerShell command (32-byte payload encoded). |

---

## Total cost (monthly)

| Service | Free tier covers | Cost above |
|---|---|---|
| Neon | 0.5 GB Postgres + 191 compute-hours/mo | $19/mo for 10 GB |
| Resend | 100 emails/day, 3000/mo | $20/mo for 50k/mo |
| Vercel | Hobby tier: unlimited static, 100 GB bandwidth | $20/mo for Pro |

You'll stay free until you have ~50-100 active issuers / day. Total cost from $0 to ~$60/mo when you cross those thresholds.

---

When you finish this walkthrough, reply to me with **"dashboard live"** and I'll dogfood it from my side to make sure the end-to-end flow works.
