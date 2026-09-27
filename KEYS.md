# Signing keys

> **⚠️ This file is inherited from upstream Open Grind and only partly applies to
> GrindrX.** Read the two sections below before trusting anything here.
>
> - **PGP Public Key** — this is **upstream Open Grind's** key
>   (`opengrind.org/pgp`, "Grind Governance"). It is *not* the key used for
>   GrindrX APKs, and the fork does not use it to sign anything. It is retained
>   because `KEYS.md.asc` is a signature over this file made with that key.
>   **Consequence: editing this file invalidates `KEYS.md.asc`.** `gpg --verify
>   KEYS.md.asc KEYS.md` will now report a *good signature over a different
>   document* rather than a bad signature. That is expected after the v0.1.33
>   edit; re-signing with the fork's own key is a DECISION NEEDED (the fork has
>   no PGP key of its own — see "Governance certification").
> - **Android APK Signing** — this section has been corrected for GrindrX. It
>   used to publish the **upstream governance** certificate
>   (`28:05:FD:D8:…:C3:65:8C`), which no GrindrX APK has ever been signed with.
>   Following it would produce a spurious "tampered APK" conclusion. The real
>   certificate is below.
> - **Governance certification** — upstream text naming `@hloth` as the decision
>   making authority. That governance structure does not apply to this fork; see
>   the banner in [GOVERNANCE.md](./GOVERNANCE.md).

## PGP Public Key

> **Upstream Open Grind's key, not the fork's.** Kept for the `KEYS.md.asc`
> signature and for verifying upstream open-grind releases. It does **not** sign
> GrindrX APKs.

Public key: <https://opengrind.org/pgp>

Fingerprint:

```
CB72 2EE9 67E4 FCAD 7C65 8FC6 9A1F 7F5F 5929 19D2
```

Armored:

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEagOyrBYJKwYBBAHaRw8BAQdAyg0H1UG48kwMu/iOTcRHBsOSx8XOaH3dQprB
vTp/U360OE9wZW4gR3JpbmQgR292ZXJuYW5jZSAoaHR0cHM6Ly9vcGVuZ3JpbmQu
b3JnL2dvdmVybmFuY2UpiJMEExYKADsWIQTLci7pZ+T8rXxlj8aaH39fWSkZ0gUC
agOyrAIbAQULCQgHAgIiAgYVCgkICwIEFgIDAQIeBwIXgAAKCRCaH39fWSkZ0gUU
AP9fjzZCM1QnRaBoeaYW9ZsIqxLD1cNcRQTr1ZDxyrDfZAD8CpXHm6z40FflnYpH
fPPsr3kmJDmYmWfBQopOV/ZkeAK4MwRqA7OuFgkrBgEEAdpHDwEBB0Bv7x60FRQP
vNovgvpuyRpJBrRQ0S5v9aL1czIQOHh/7Ij1BBgWCgAmFiEEy3Iu6Wfk/K18ZY/G
mh9/X1kpGdIFAmoDs64CGwIFCQHhM4AAgQkQmh9/X1kpGdJ2IAQZFgoAHRYhBDJ/
VO0dIzjm07OTASL4OLBKFubeBQJqA7OuAAoJECL4OLBKFubectsBAKOs4M+zRpvc
z0IwhuQbra4zenJiMUsC3dtdP9MMTV9aAQCAnU9dBM42IYdm9MTLy/2e1K4lIeV0
L5btj2UQ3ZPmB15mAQDJNf08gI4nMXzsVH2rulMkYVW9RFaKy0INrWXvBmzexwEA
n9ALznossxQtTWKrTg6+kwpmc/7ZVXzhGCXcHUAZWwo=
=b377
-----END PGP PUBLIC KEY BLOCK-----
```

Verify release:

```bash
gpg --fetch-keys https://opengrind.org/pgp.asc
gpg --verify opengrind.apk.asc opengrind.apk
```

## Android APK Signing

> **Corrected in v0.1.33.** This section previously published the *upstream Open
> Grind* certificate. No GrindrX APK has ever been signed with it.

**This is the certificate every published GrindrX APK is signed with.** It is the
fork's own Java KeyStore (`~/open-grind-key.jks`, alias `grindx`) — it is **not**
the upstream governance key. The same certificate is used for every release from
v0.1.15 onward, which is what lets a new version install as an in-place upgrade
over an existing install.

SHA-256 certificate fingerprint:

```
22:D6:88:9E:F0:74:59:A2:09:19:D4:8A:FF:FE:7E:D7:A4:E3:90:30:39:E1:55:42:76:7C:ED:CD:FF:8D:4C:01
```

Equivalently, without separators:

```
22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01
```

Verify a downloaded APK:

```bash
apksigner verify --print-certs GrindrX-vX.Y.Z.apk
```

`apksigner` should print, for the signer that signed the APK:

```
Signer #1 certificate SHA-256 digest: 22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01
```

If it prints `2805fdd8f0badb9424d3244c5e5b3473cef5b8798ec1117382e89eda45c3658c`
instead, you are looking at an **upstream open-grind** APK (or a different
application), not a GrindrX release.

Corroborating sources for this value, all of which agree:

| Source | Value |
| --- | --- |
| [README.md](./README.md) — "Verify your download" and "Security" | `22:D6:…:8D:4C:01` |
| [FDROID.md](./FDROID.md) — Notes | "the **APK** key (`~/open-grind-key.jks`, cert `22:D6:88:9E…4C:01`)" |
| `memory/SESSION_STATE.md` — v0.1.16 signing note | "cert SHA-256 is `22d6889e…4c01` (the fork's own GrindrX key, `~/open-grind-key.jks` alias `grindx`), NOT the `2805fd…c3658c` in `KEYS.md`" |
| `memory/MEMORY.md` — shipped v0.1.33 | "cert `22d6…4c01`" |

The per-release SHA-256 of the APK itself (a different value — that is the
file hash, not the certificate hash) is published in [README.md](./README.md)
under "Verify your download".

For the full reproduction procedure — build the unsigned APK yourself and diff it
against the published one, signing block excluded — see
[BUILDING.md → Verifying a published release](./BUILDING.md#verifying-a-published-release).
That section's release URL was also corrected in v0.1.33; it used to point at the
**upstream** `git.opengrind.org/open-grind/open-grind` release page.

## Governance certification

> **Upstream text — does not apply to GrindrX.** This certifies *upstream Open
> Grind's* PGP key against *upstream's* decision making authority. Neither the key
> above nor that authority has any role in GrindrX releases. See the banner in
> [GOVERNANCE.md](./GOVERNANCE.md).

Open Grind's public PGP key is certified by [governance's decision making authority](./GOVERNANCE.md) — Viktor Shchelochkov (https://hloth.dev, [PGP key](https://hloth.dev/pgp)):

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEagOyrBYJKwYBBAHaRw8BAQdAyg0H1UG48kwMu/iOTcRHBsOSx8XOaH3dQprB
vTp/U360OE9wZW4gR3JpbmQgR292ZXJuYW5jZSAoaHR0cHM6Ly9vcGVuZ3JpbmQu
b3JnL2dvdmVybmFuY2UpiJMEExYKADsWIQTLci7pZ+T8rXxlj8aaH39fWSkZ0gUC
agOyrAIbAQULCQgHAgIiAgYVCgkICwIEFgIDAQIeBwIXgAAKCRCaH39fWSkZ0gUU
AP9fjzZCM1QnRaBoeaYW9ZsIqxLD1cNcRQTr1ZDxyrDfZAD8CpXHm6z40FflnYpH
fPPsr3kmJDmYmWfBQopOV/ZkeAKIdQQTFgoAHRYhBANvfSJCl9hzpPzp2imemkUB
MqKMBQJqA7xrAAoJECmemkUBMqKMQuwA/2NdApZCriVplMjF5CgBpVG1kYvPesAk
O+R/CdsK0p5+AQCt/Y7X5UBMFTG8HcBivUMcHGhg8BQg/5LFWNWyFNlsA7gzBGoD
s64WCSsGAQQB2kcPAQEHQG/vHrQVFA+82i+C+m7JGkkGtFDRLm/1ovVzMhA4eH/s
iPUEGBYKACYWIQTLci7pZ+T8rXxlj8aaH39fWSkZ0gUCagOzrgIbAgUJAeEzgACB
CRCaH39fWSkZ0nYgBBkWCgAdFiEEMn9U7R0jOObTs5MBIvg4sEoW5t4FAmoDs64A
CgkQIvg4sEoW5t5y2wEAo6zgz7NGm9zPQjCG5ButrjN6cmIxSwLd210/0wxNX1oB
AICdT10EzjYhh2b0xMvL/Z7UriUh5XQvlu2PZRDdk+YHXmYBAMk1/TyAjicxfOxU
fau6UyRhVb1EVorLQg2tZe8GbN7HAQCf0AvOeiyzFC1NYqtODr6TCmZz/tlVfOEY
JdwdQBlbCg==
=5Fn1
-----END PGP PUBLIC KEY BLOCK-----
```