# Account

## GrindrX client support status

Which of the endpoints above GrindrX actually calls, and why the others are
not wired. Kept here because this page is the project's only vendored reference
for these endpoints, and a reader who finds `POST /v3/users/email` listed above
has no way to tell whether the app uses it.

- **Password reset — `POST /v3/users/forgot-password` — IN USE.** This is the
  single supported reset path. It previously existed twice in the codebase with
  two different endpoints: a Rust command implemented this one, while the reset
  form posted `/v1/accounts/password/reset`, which appears nowhere in this
  reference and which the commit that added the Rust command described as "a
  non-existent path". The Rust command was removed and the form now sends this
  endpoint through the unauthenticated `request_public` bridge.
  `src/lib/api/auth-contract.ts` owns the path; `auth-contract.guard.test.ts`
  fails if a second reset path reappears.
- **Account creation — UNVERIFIED.** Called as `POST /v1/accounts`, which is
  also not listed above; the reference records creation only as `POST (dynamic,
  WIP)`, and the fields of `CreateAccountEmailRequest` are not documented here.
  The request body is left exactly `{ email, password, displayName }`. No
  date-of-birth, terms-of-service or email-verification field was added, because
  there is no evidence the server accepts one and a client-side check the server
  ignores is not a control. The declared gaps live in
  `REGISTRATION_GAPS` (`src/lib/api/auth-contract.ts`).
- **Change email — `POST /v3/users/email` — DOCUMENTED, NOT USED.** The endpoint
  is listed above, but the fields of `UpdateEmailRequest` are not documented in
  this repository, nor is whether the call re-authenticates the password or
  requires a confirmation round-trip to the new address. GrindrX therefore does
  not offer in-app email changes and routes the user to support instead. See
  `settings/(subpage)/account/email/+page.svelte`.
- **Age assurance — NOT IMPLEMENTED.** What exists is the FaceTec
  document/liveness flow under [age verification](/grindr-api/browse/age-verification),
  which is a separate, unimplemented feature — not a date-of-birth field on
  account creation.

None of the above has been exercised against a live Grindr server from within
this repository; these are the conclusions the code and this reference support,
not observed API responses.

## Account settings, WIP

- POST /v3/users/password-validation ValidatePasswordComplexityRequest
- POST /v3/gcm-push-tokens FcmPushRequest
- POST /v3/users/update-password ChangePasswordRequest ChangePasswordResponse
- POST /v3/users/email UpdateEmailRequest AuthResponse
- POST (dynamic, WIP) LoginEmailRequest AuthResponse
- POST /v4/sms/users/update-password ChangePasswordPhoneRequest ChangePasswordResponse
- POST (dynamic, WIP) CreateAccountEmailRequest FirstPartyCreateAccountResponse
- POST /v7/users/thirdparty CreateThirdPartyAccountRequest ThirdPartyCreateAccountResponse
- POST /v3/users/forgot-password ForgotPwdEmailRequest ForgotPwdEmailResponse
- POST /v3/users/thirdparty/exchange GoogleAccessTokenRequest GoogleAccessTokenResponse
- POST /v4/sms/sessions LoginPhoneRequest AuthResponse
- POST (dynamic, WIP) ThirdPartyRequest ThirdPartyAuthResponse
- POST (dynamic, WIP) ThirdPartySessionRequest ThirdPartyAuthResponse

## Get preferences

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v3/me/prefs/settings
```

Response:

- `profileId` — integer
- `locationSearchOptOut` — boolean
- `incognito` — boolean
- `hideViewedMe` — boolean
- `approximateDistance` — boolean
- `viewRightNowNsfw` — boolean

## Set preferences

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v3/me/prefs/settings
```

Body:

- `locationSearchOptOut` — boolean
- `incognito` — boolean
- `hideViewedMe` — boolean
- `approximateDistance` — boolean
- `viewRightNowNsfw` — boolean

Response:

Empty.

## Get visiting settings

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/visiting/settings
```

Response:

- `setting` — string, e.g. `"AUTO"`

## Set visiting settings

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v1/visiting/settings
```

Body:

- `setting` — string, e.g. `"AUTO"`, WIP

Resonse:

Empty.

## Get home location

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/visiting/home
```

Response:

- `name` — string, [human-readable name](/grindr-api/browse/location#search-places-by-name) of location
- `lat` — float
- `lon` — float

## Set home location

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v1/visiting/home
```

Body:

- `lat` — float
- `lon` — float

Response:

- `name` — string, [human-readable name](/grindr-api/browse/location#search-places-by-name) of location
- `lat` — float
- `lon` — float

