# Privacy Policy — Undertone

> **DRAFT — requires counsel review before publication.**
> Drafted 2026-07-15. Company name, entity type, jurisdiction, and all regulatory
> specifics are placeholders marked `[COMPANY]` and `[COUNSEL: …]` for legal review.
> Every technical claim in this document was written to match what the Undertone code
> actually does as of the drafting date; if the code changes, this policy must change with it.

**Effective date:** [COUNSEL: effective date]
**Who we are:** [COMPANY] ("we", "us", "our"), the maker of Undertone (the "app" or
"Service") — a push-to-talk dictation app that turns speech into polished text at your cursor.
**Contact:** [COUNSEL: privacy contact — email / postal address / DPO if required]

---

## 1. The short version

- We stream your microphone audio to a speech-to-text service **while you are speaking** so we
  can transcribe it. **We do not store your audio.** Once your speech has been transcribed, the
  audio is gone from our servers.
- We **do** store the resulting text transcripts, so you can search and reuse your dictation
  history across your devices. Those transcripts are **encrypted at rest**.
- We collect **anonymous** usage and performance data to keep the app fast and working. It
  **never contains what you dictated.** You can turn it off.
- You can **delete** any transcript, or all of your history, at any time.
- We do not sell your data. We are not directed at children under 13.

The rest of this document is the detail behind those points.

---

## 2. What we collect, why, and where it goes

### 2.1 Microphone audio (not stored)

When you hold your dictation hotkey and speak, the app captures your microphone audio, converts
it to a compact format on your device, and streams it to our servers, which relay it to our
speech-to-text provider (Deepgram) to produce a transcript.

**We do not persist your audio server-side.** There is no feature in this version of the app
that saves your recorded audio on our servers. The audio exists only transiently, in memory,
for as long as it takes to transcribe it, and is then discarded.

- **Why:** transcription is the core function of the app — turning what you said into text.
- **Legal basis (if applicable):** [COUNSEL: e.g. performance of contract / GDPR Art. 6(1)(b)]

### 2.2 Transcripts (stored, encrypted)

The **text** produced from your speech — your transcript — is stored so that your dictation
history is available and searchable across your devices (this is the history feature).

- Transcripts are **encrypted at rest** using **AES-256-GCM** encryption. The plaintext of a
  transcript is never written to disk on our servers.
- To let you **search** your history without decrypting everything, we build a **keyed hash
  index**: each word is run through a keyed one-way function (HMAC-SHA256) and only the
  resulting hashes are stored. This index contains **no readable text** — it cannot be reversed
  back into your words. Search works by hashing your search term the same way and matching
  hashes. (Exact-word search only in this version.)
- Alongside each transcript we store limited metadata: the name of the app you were dictating
  into, a general register label (for example "chat", "email", "code"), a word count, and a
  timestamp.
- **Why:** to provide cross-device, searchable dictation history.
- **Legal basis (if applicable):** [COUNSEL: performance of contract / legitimate interests]

### 2.3 Account data

To sign you in and manage your subscription we hold account information through our providers:

- **Authentication** is handled by **Clerk**. This includes your email address and the sign-in
  identifiers Clerk manages on our behalf.
- **Payments and subscriptions** are handled by **Stripe**. We do **not** receive or store your
  full card number; Stripe processes payment details directly. We retain a customer reference,
  your plan, subscription status, and billing period.
- **Why:** to give you an account, apply your plan and usage limits, and bill you if you
  subscribe.
- **Legal basis (if applicable):** [COUNSEL: performance of contract]

### 2.4 Your custom dictionary

If you add words to your custom dictionary (for example proper nouns that speech-to-text tends
to mishear), we store those entries associated with your account so we can improve your
transcription accuracy.

### 2.5 Usage limits and metering

We count the number of words produced for you each week, on our servers, at the moment your text
is formatted. We use this count to apply your plan's fair-use limit (see the Terms of Service).
This is a **count** — it is a number, not the content of what you dictated.

### 2.6 Anonymous usage and performance telemetry

We collect anonymous product analytics to understand how the app is used and to keep it fast:

- What it contains: **usage counts** (for example, how many dictations occurred) and **latency
  timings** (how long each step of the pipeline took).
- What it **never** contains: the content of your transcripts or your audio. By design, our
  timing and telemetry data carry no transcript content.
- It is **anonymous by default**.
- Our analytics run on a **self-hosted** analytics system (PostHog) that we operate ourselves.
  Because we host it, your telemetry is not handed to a third-party analytics vendor. If
  telemetry is not configured, it is simply off.
- **You can disable telemetry** in the app's settings.
- **Legal basis (if applicable):** [COUNSEL: consent / legitimate interests — confirm the
  opt-out vs. opt-in posture required in each jurisdiction]

---

## 3. Who we share data with (subprocessors)

We use the following service providers ("subprocessors") to run the Service. Each receives only
the data it needs for its function:

| Provider | Function | What it handles |
|---|---|---|
| **Deepgram** | Speech-to-text | Streamed audio, transiently, to produce transcripts |
| **Anthropic** | Text formatting | The transcribed text, to clean and format it |
| **Clerk** | Authentication | Your account identity and email |
| **Stripe** | Payments | Your billing and subscription details (card handled by Stripe) |
| **Fly.io** | Hosting | Operates the servers the Service runs on |

We also operate a **self-hosted PostHog** instance for anonymous telemetry. Because we host it
ourselves, it is **not** a third party that receives your data.

We do not sell your personal data. [COUNSEL: confirm "sale"/"share" definitions and disclosures
required under CCPA/CPRA and any other applicable law.]

[COUNSEL: list the processing locations / countries of the above providers and the transfer
mechanism (e.g. Standard Contractual Clauses) if required for GDPR or other cross-border rules.]

---

## 4. How long we keep your data

- **Transcripts:** kept until **you delete them**. You can delete individual transcripts or your
  entire history at any time (see Section 6). Deleted transcripts are removed from our active
  systems. [COUNSEL: confirm backup retention window and describe it here.]
- **Account data:** kept for as long as you have an account. [COUNSEL: describe deletion on
  account closure and any retention required for legal/accounting purposes.]
- **Audio:** not retained (see Section 2.1).
- **Anonymous telemetry:** [COUNSEL: state the telemetry retention period.]

---

## 5. Where your data is processed

The Service is hosted on Fly.io, and audio/text is processed by the providers listed in
Section 3, which may operate in [COUNSEL: list regions]. [COUNSEL: describe international data
transfer safeguards where applicable.]

---

## 6. Your rights and choices

- **Access:** you can view your dictation history in the app. You can see your account and usage
  details in the app. [COUNSEL: describe any formal data-access / portability request process
  required by law.]
- **Deletion:** you can delete any individual transcript, or delete all of your history, from
  within the app at any time. [COUNSEL: describe full account deletion process and how to
  request it.]
- **Turn off telemetry:** you can disable anonymous telemetry in settings.
- **[COUNSEL: additional GDPR rights** — rectification, restriction, objection, portability,
  right to lodge a complaint with a supervisory authority — state and describe as applicable.]
- **[COUNSEL: additional CCPA/CPRA rights** — right to know, delete, correct, opt out of
  sale/sharing, non-discrimination — state and describe as applicable.]

To exercise any right that is not self-service in the app, contact us at [COUNSEL: rights
request contact].

---

## 7. Security

- Transcripts are encrypted at rest with AES-256-GCM.
- The search index stores only irreversible keyed hashes of words, never readable text.
- The encryption key for transcript content and the key used for the search index are
  **separate** keys.
- Access to the app's servers requires authentication.

No system is perfectly secure, and we cannot guarantee absolute security. [COUNSEL: add breach
notification commitments required by applicable law.]

---

## 8. Children

The Service is **not directed at children under 13**, and we do not knowingly collect personal
information from children under 13. [COUNSEL: confirm the correct age threshold and obligations
for each jurisdiction — e.g. 16 under GDPR in some member states — and add COPPA specifics if
applicable.] If you believe a child has provided us personal information, contact us at [COUNSEL:
contact] and we will delete it.

---

## 9. Changes to this policy

We may update this policy from time to time. When we make material changes, we will [COUNSEL:
describe notification method — e.g. in-app notice and updated effective date]. The current
version is always available at [COUNSEL: canonical URL].

---

## 10. Contact us

[COMPANY]
[COUNSEL: full legal entity name, registered address, and privacy/DPO contact email]
