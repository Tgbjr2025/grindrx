# ANCHOR — one page. Read this when your memory is bad today.

**You do not have to remember anything. The system remembers. This page only
tells you where to look.**

---

## Where do I look?

**📱 Open the Anchor app on your home screen.**
The first screen is **Today**: what's next, in big type, and calls you owe.
That screen is the truth. If your memory says something different, **the app
is right** — tap the quote under an event to hear the actual call.

**🔔 A yellow banner says "items need your OK"?**
Tap it. For each item: **Yes, do it** / **Fix it** / **Dismiss**. That's all.

**❓ Not sure about anything?** Tap **Ask** and type the question, like:
- *"When is my next appointment?"*
- *"What did the imaging office say?"*
- *"Did I already call the pharmacy back?"*

Every answer shows a ▶ chip — tap it to hear the recording it came from.

---

## You never have to do anything for calls

Calls and voicemails record and upload **by themselves**. Just talk.
Appointments land on your Google Calendar **by themselves**, with reminders
2 hours and 45 minutes before. You'll get a push message quoting what was said.

**Got a push that's wrong?** In Termux type:
`anchor fix event 12 it's 1pm not 12:30` — (the number is in the push message).

---

## Quick captures (Termux)

| I want to… | Type |
|---|---|
| Save a spoken thought | `anchor rec` … talk … `anchor stop` |
| Save a photo of paper | `anchor photo` |
| Save a text note | `anchor note pick up meds Thursday` |
| Ask a question | `anchor ask when is PT` |
| Correct something | `anchor fix ...what's wrong...` |
| Log a symptom | `anchor log headache since lunch` |
| Report for the doctor | `anchor report` (PDF lands in Downloads) |

Texts (SMS) save themselves — nothing to do.

---

## Rough day?

Open the app → **More** → **Turn on bad-day mode**. Everything shrinks to
just Today and Confirm, in very large text. Turn it off from the bottom of
the Today screen when you're ready.

**Where did that come from?** Open **Timeline**, tap any item, tap any line
of the transcript — it plays that exact moment of the recording.

---

## Is it working?

- Morning push at 8:00 = system alive. **No morning push = something is wrong.**
- The digest's last line shows health. `phone sync NEVER/old` = open Termux once.
- Still broken? `anchor status` in Termux, or on the server:
  `systemctl status anchor-api anchor-worker`. Rebooting the phone or the
  server is SAFE — nothing is lost, everything resumes by itself.

---

## Rules the system lives by (so you can trust it)

1. Everything it says is backed by a recording or message you can play.
2. It never deletes. Corrections keep the original underneath.
3. If it wasn't sure, it ASKED you (the Confirm screen) instead of guessing.
4. Attorney calls are stored but kept out of every report and export.
5. If it breaks, it tells you loudly. Silence at 8 AM = check it.

**The token** (for a new phone/browser): sealed envelope in the desk drawer,
and in the password manager under "Anchor".
