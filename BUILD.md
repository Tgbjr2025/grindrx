# Building grindrx-work

Generated 2026-10-05T23:30:14+02:00 from the tree as it exists at migration time.

## Build system

npm/yarn (package.json)

## Dependencies

`package.json` + lockfile are authoritative:

```bash
npm ci        # or: yarn install --frozen-lockfile
```

## Tests

npm test

## Run

Entry point: `package.json scripts.start`

```bash
npm run dev    # or: node package.json scripts.start
```

## Environment variables

See `.env.example` if present. Real values live in `/srv/secrets/` and are
never committed. This repository contains templates only.

## Runtime data

Runtime state (databases, caches, uploads, logs) is intentionally NOT in this
repository. It belongs under `/srv/data/<project>/` or is managed by the
deployed service.
