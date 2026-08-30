# Putting GrindrX on F-Droid

There are two ways to get an app "on F-Droid". This document covers both, recommends the practical
one for GrindrX (**your own F-Droid repository**), and documents how that repo is set up and updated.

---

## The short version (for users)

Install the [F-Droid app](https://f-droid.org/), then add the GrindrX repository. Use the
**fingerprint-pinned** link so the client verifies the repo key:

```
https://cam.dominusaxis.com/fdroid/repo?fingerprint=EE96F55410D8C32967546245885717037F4D20EF344D5BD186246BA4EED523A5
```

1. F-Droid → **Settings** → **Repositories** → **＋** → paste the URL above (or scan a QR of it).
2. Enable it, pull to refresh, then search **GrindrX** and install.

You'll now get update notifications and one-tap upgrades in F-Droid whenever a new version ships.
(GrindrX is signed with the same key across versions, so updates install in place.)

---

## "How do people find it if it isn't on the F-Droid site?"

Honest answer: **with your own repo, they don't *browse* to it — you hand them the link.** A custom
repository is not searchable from F-Droid's default catalog; a user only sees GrindrX after they've
added the repo URL above. So discovery happens *outside* F-Droid — the repo just handles
install + auto-updates once added. Ways to spread it:

- Put the repo link + a **QR code** on the GitHub README, your site, and socials (F-Droid can add a
  repo by scanning a QR of the URL). Generate one with e.g. `qrencode -o grindrx-fdroid.png '<url>'`.
- The in-app **"Share GrindrX with a friend"** button (Settings → Community) — point its link at the
  repo.

If you want GrindrX to be **browsable/searchable inside an F-Droid client**, you have two options
beyond your own repo:

1. **IzzyOnDroid** *(recommended for real discoverability)* — a large, well-trusted third-party
   F-Droid repo that a big share of privacy-minded users already have added. It does **not** rebuild
   from source (it ingests your published, self-signed APK) and it's a light submission: publish
   releases on GitHub, add a `fastlane`/`metadata` structure to the repo, and open a request at
   [gitlab.com/IzzyOnDroid/repo](https://gitlab.com/IzzyOnDroid/repo). Apps there are searchable by
   everyone who has the IzzyOnDroid repo, and it can auto-track your GitHub releases. This is the
   realistic path to "findable" for a client like GrindrX. (It'll still carry the `NonFreeNet`
   anti-feature.)
2. **Official f-droid.org catalog** — maximum reach, but the hardest fit (see below), and you give up
   control of signing.

---

## Why an own repo (and not the official f-droid.org catalog)

The official catalog builds every app **from source on F-Droid's own build servers** and signs it with
**F-Droid's** key, and the app must pass F-Droid's [inclusion policy](https://f-droid.org/docs/Inclusion_Policy/)
and build reproducibly. For GrindrX that's a poor fit and a long shot:

- It's a third-party client for a **proprietary network service** (Grindr) and sends spoofed
  client/device headers. At minimum this earns the `NonFreeNet` anti-feature; it may also raise
  policy / impersonation concerns during review.
- The build is Tauri (Rust) + SvelteKit + a Nix flake — a heavy, non-standard build-server recipe.
- Merging into [`fdroiddata`](https://gitlab.com/fdroid/fdroiddata) is a multi-week review with real
  rejection risk, and you'd give up control of signing.

**Your own repo** gives users the same F-Droid experience (browse + auto-update) while you keep your
`grindx` signing key and control releases. That's what the URL above is.

---

## Maintainer guide — set up the repo (once)

Done on the host that already serves `cam.dominusaxis.com` (HTTPS). Requires `fdroidserver`, a JDK,
and Android build-tools (`aapt`), all present on the box.

```bash
pipx install fdroidserver          # the `fdroid` CLI

mkdir -p ~/fdroid && cd ~/fdroid
fdroid init                        # creates config.yml + a repo-signing keystore (keystore.p12)
```

`fdroid init` generates a **repo index** signing key — this is separate from the APK signing key and
signs the repository's index so clients can trust it. **Back up `~/fdroid/keystore.p12` and
`config.yml`** — losing them means every user has to remove and re-add the repo.

Edit `~/fdroid/config.yml`:

```yaml
repo_url: "https://cam.dominusaxis.com/fdroid/repo"
repo_name: "GrindrX"
repo_description: "Privacy-focused Grindr client for Android."
```

Add the app metadata at `~/fdroid/metadata/com.grindrx.app.yml`:

```yaml
Categories:
  - Internet
License: MIT
AuthorName: Tgbjr2025
WebSite: https://github.com/Tgbjr2025/grindrx
SourceCode: https://github.com/Tgbjr2025/grindrx
IssueTracker: https://github.com/Tgbjr2025/grindrx/issues
Changelog: https://github.com/Tgbjr2025/grindrx/blob/main/CHANGES.md
Name: GrindrX
Summary: Privacy-focused Grindr client
Description: |-
  An unofficial, ad-free, tracker-free Grindr client built with Tauri 2 and SvelteKit.
  Adds voice messages, saved phrases, album management, favorite notes, a PIN/biometric
  app lock, notification controls, search, and more on top of the standard experience.
AntiFeatures:
  - NonFreeNet        # talks to Grindr's proprietary service
```

Drop the signed APKs in and build the index:

```bash
cp ~/grindrx-artifacts/GrindrX-v*.apk ~/fdroid/repo/
cd ~/fdroid
fdroid update -c     # -c fills in metadata stubs; reads each APK, writes + signs index-v1/-v2.json
```

`fdroid update` extracts each APK's `versionName`/`versionCode`/icon and publishes the newest as the
current version. It prints the repo fingerprint — you can hand out a pinned URL
`…/repo?fingerprint=<SHA256>` so clients verify the index key on add.

### Hosting

Serve `~/fdroid/` so the repo lives at `…/fdroid/repo`. On the `cam.dominusaxis.com` vhost, add:

```nginx
location /fdroid/ {
    auth_basic off;                 # the vhost is basic-auth'd; the repo must be public
    alias /home/ubuntu/fdroid/;
    autoindex off;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`. Verify:
`curl -sI https://cam.dominusaxis.com/fdroid/repo/index-v1.json` → 200.

---

## Publishing a new version (each release)

```bash
cp ~/grindrx-artifacts/GrindrX-vX.Y.Z.apk ~/fdroid/repo/
cd ~/fdroid && fdroid update
```

That's it — the index is regenerated and re-signed in place, and F-Droid clients that have the repo
added will show the update on their next refresh. Keep bumping `versionCode` each release (the build
does this) so F-Droid recognises it as newer.

---

## Getting into IzzyOnDroid (searchable discovery)

IzzyOnDroid ingests the **published, self-signed APK** from GitHub releases — no rebuild from source —
and reads the repo's fastlane metadata, so the listing (description, icon, per-version changelogs)
comes straight from `fastlane/metadata/android/en-US/` in this repo (already in place).

Prerequisites (done): public GitHub repo with an OSI license, tagged releases each carrying an APK
whose filename/versionCode increases, and the fastlane metadata folder.

To submit (needs a GitLab account — a maintainer action, not automatable here):

1. Go to https://gitlab.com/IzzyOnDroid/repo/-/issues → **New issue** → the *Request Application*
   template.
2. Fill in and post (values for GrindrX):
   - **App name:** GrindrX
   - **Package ID:** `com.grindrx.app`
   - **Source / releases:** https://github.com/Tgbjr2025/grindrx (APKs on the Releases page)
   - **License:** MIT
   - **Notes:** Unofficial Grindr client (fork of open-grind), Tauri 2 + SvelteKit. Talks to Grindr's
     proprietary service → please tag `NonFreeNet`. Fastlane metadata + icon + changelogs are in the
     repo under `fastlane/metadata/android/en-US/`.
3. After a maintainer accepts it, IzzyOnDroid auto-tracks new GitHub releases — publish a release and
   it appears as an update for everyone who has the IzzyOnDroid repo added (which is a lot of users).

Users then find GrindrX by **searching in F-Droid** once they've added IzzyOnDroid
(`https://apt.izzysoft.de/fdroid/repo`), which many already have.

## Notes

- Two keys are in play: the **APK** key (`~/open-grind-key.jks`, cert `22:D6:88:9E…4C:01`) that signs
  the app, and the **repo index** key (`~/fdroid/keystore.p12`) that signs the repository. Back up both.
- Adding a third-party repo is a trust decision for users; that's inherent to non-official F-Droid
  distribution. The fingerprint-pinned URL mitigates it.
- Official f-droid.org inclusion remains possible later as a separate, larger effort.
