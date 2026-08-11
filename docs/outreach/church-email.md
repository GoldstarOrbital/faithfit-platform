# Church outreach

Cold outreach to churches about Functioning Faith. Draft copy, target-list
method, and the legal/deliverability constraints that actually govern whether
any of it lands.

> **Nothing here has been sent.** This is the asset; sending is a separate,
> deliberate act that needs a real list, a sending domain, and Alex's sign-off.

## Do this first, or the email is wasted

**The link in the email is the entire ask.** Right now the live app is at
`faithfit-demo-production.up.railway.app`. A pastor who receives a cold email
pointing at a URL with "demo" in it will read it as a student project, and
`app.functioningfaith.com` still does not resolve (no DNS record — see the
Railway notes). Fix the domain before the first send. One good email to a
church is not repeatable; you do not get a second first impression.

Also worth having ready before sending:
- A visible privacy policy and terms (both exist: `/privacy.html`, `/terms.html`).
- A named human to reply to. Cold outreach from a no-reply address is ignored.

## The email

Short on purpose. Church staff are busy, get pitched constantly, and delete
anything that opens with a paragraph about mission and vision.

---

**Subject:** A free fitness app that puts your sermons in front of your congregation

Hi {{first_name}},

I built a faith-based fitness app called Functioning Faith — think Strava, but
the encouragement is scripture instead of vanity metrics.

One feature is why I'm writing. If a church links its YouTube channel or
website, its sermons and devotionals show up inside the app for members who
select that church. Your people see your teaching during the week, in the app
they're already opening to log a run.

It's free, there's nothing to install, and linking takes about a minute — you
paste a channel URL and you're done.

If it's useful to {{church_name}}, you can link it here: {{link}}
If it isn't, no follow-up from me.

{{sender_name}}
{{sender_email}}

---

### Why it is written this way

- **The subject names the benefit to them**, not the product. "Free fitness
  app" alone gets deleted.
- **One feature, not the whole app.** Church-video surfacing is the only part
  that is about *them*. Everything else is about the member.
- **"No follow-up from me" is deliberate** and should be honoured. It raises
  reply rates and it is the honest thing to say in a first cold email.
- **No claim about congregation size, engagement, or outcomes.** There is no
  data to support one, and a pastor will spot an invented statistic instantly.

## Building the list

**Do not scrape.** The app already queries OpenStreetMap via Overpass for
church discovery, and it would be technically easy to pull thousands of names —
but OSM church records rarely carry an email, and repurposing data collected for
map display into a marketing list is both a compliance problem and the kind of
thing that gets a sending domain blocklisted.

A defensible list, in order of quality:

1. **Churches you or your network actually have a relationship with.** Warm
   intros convert an order of magnitude better than cold sends, and there is no
   compliance question.
2. **Publicly listed staff contact pages**, collected by hand, in your area
   first. Slow, small, and it works. Fifty well-chosen churches beat five
   thousand scraped ones.
3. **Denominational directories** where churches have published contact details
   for the purpose of being contacted.

Start with 20–50. If the reply rate is bad, the email is wrong and sending it to
5,000 more will only burn the domain.

## Legal requirements (US, CAN-SPAM)

These are not optional and apply to a one-person project the same as to a
company:

- **Accurate From, Reply-To, and subject line.** No misleading headers.
- **A valid physical postal address** in every message.
- **A working unsubscribe** in every message, honoured within 10 business days.
- **Suppress opt-outs permanently.** One send to someone who asked you to stop
  is the violation, not the pattern.

If any recipients are in the UK/EU, GDPR and PECR apply and are stricter — for
organisational contacts the bar is a legitimate-interest assessment plus an easy
opt-out. Worth restricting the first campaigns to the US.

## How to actually send

**Not from your personal Gmail.** Gmail throttles around 500 recipients/day,
cold bulk from a personal account risks the account itself, and everything lands
in spam because the domain has no sending reputation.

The app already has a Resend integration (`lib/account-security.js`) that codex
added for password resets. Resend is the sane path for outreach too:

1. Verify `functioningfaith.com` as a sending domain in Resend.
2. Add SPF, DKIM and DMARC records. Without these, cold email goes to spam
   regardless of content.
3. Warm the domain: ~20–30 sends/day for the first two weeks, increasing
   gradually. A new domain that sends 2,000 messages on day one gets filtered.
4. Set `RESEND_API_KEY` and `EMAIL_FROM` (currently unset in production).

Use a **separate subdomain** for outreach — e.g. `hello@mail.functioningfaith.com`
— so that if outreach reputation suffers, password-reset and other transactional
mail from the root domain is unaffected. Mixing them is the mistake that takes
down your ability to send account emails.

## What to measure

Replies, not opens. Open tracking is unreliable (Apple Mail Privacy Protection
pre-loads images) and optimising for it teaches you nothing. Count:

- churches that replied
- churches that linked a channel
- unsubscribes and complaints — if complaints exceed ~0.1%, stop and rewrite

## Not built

There is no outreach system in this codebase: no list storage, no unsubscribe
handling, no suppression list, no send scheduling. If this becomes a real
channel rather than a hand-sent 50, those need building, and the unsubscribe and
suppression parts are legal requirements rather than features.
