# Undocumented API Endpoint Discoveries

These endpoints were discovered by inspecting live Grindr network traffic via logcat
during development. All responses are JSON unless noted.

---

## Views — who viewed your profile

```
GET /v7/views/list
```

**Response shape:**
```json
{
  "totalViewers": 12,
  "profiles": [
    {
      "profileId": "123456",
      "displayName": "Alex",
      "profileImageMediaHash": "a1b2c3...",
      "distance": 450.0,
      "seen": 1716220800000
    }
  ]
}
```

**Notes:**
- `profiles` key — NOT `views`
- `profileId` is a **string**, not a number (coerce with `z.coerce.number()`)
- `seen` is a **unix timestamp in milliseconds**, not a boolean

---

## Taps (Interests) — who tapped you

```
GET /v2/taps/received
```

**Response shape:**
```json
{
  "profiles": [
    {
      "profileId": 123456,
      "displayName": "Jordan",
      "profileImageMediaHash": "d4e5f6...",
      "distance": 200.0,
      "tapType": 1,
      "timestamp": 1716220800000,
      "isMutual": false
    }
  ]
}
```

**Tap type values:**
| tapType | Emoji |
|---------|-------|
| 1       | 👋    |
| 2       | 😊    |
| 3       | 🔥    |
| 4       | 😈    |

**Notes:**
- Response key is `profiles` — NOT `taps`
- Sender field is `profileId` — NOT `senderId`

---

## Right Now — people currently available nearby

```
GET /v3/cascade?rightNow=true&onlineOnly=true&nearbyGeoHash={geohash}
```

This reuses the standard cascade grid endpoint with extra query params. The response
shape is identical to the normal browse grid (`/v3/cascade`).

**⚠️ Wrong endpoint:** `/v4/browse/right-now` exists but returns **binary data**, not
JSON. Do not use it for the Right Now feed.

---

## Send a tap

```
POST /v2/taps/{profileId}
Content-Type: application/json

{ "tapType": 1 }
```

`tapType` values: 1 (👋), 2 (😊), 3 (🔥), 4 (😈)

---

## Favorites

```
GET  /v1/favorites          → { profiles: [...] }
POST /v1/favorites/{id}     → favorite a profile
DELETE /v1/favorites/{id}   → unfavorite a profile
```

---

## Block / Unblock

```
POST   /v4/blocks/{profileId}   → block
DELETE /v1/blocks/{profileId}   → unblock
GET    /v1/blocks               → { profiles: [...] } — list blocked users
```

---

## Right Now status (own profile)

```
POST   /v4/me/rightnow    body: { rightNowStatus: "HOSTING"|"NOT_HOSTING", rightNowText?: string }
DELETE /v4/me/rightnow    → clear your Right Now status
```
