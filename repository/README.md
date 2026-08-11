# Static extension repository

This directory is the transport surface for the signed
`org.substore.config-generator` package. It can be published directly from
this independent Git repository without adding a new executable trust root.

Generate and verify it from the repository root:

```bash
corepack pnpm repository
corepack pnpm verify
```

For GitHub Raw, add a catalog URL pinned to a release tag or commit:

```text
https://raw.githubusercontent.com/<owner>/<repository>/<tag-or-commit>/repository/catalog.json
```

For loopback development:

```bash
corepack pnpm repository:serve
```

Then add:

```text
http://127.0.0.1:8765/catalog.json
```

The catalog uses relative package URLs, so `catalog.json` and `packages/`
must be hosted beneath the same directory. Do not edit the envelope by hand.
The Sub-Store Host rechecks the official manifest and package digest,
per-file SHA-256 values, receipt, frontend assets, and Ed25519 signature before
it stores or executes the package.

See `../docs/CATALOG.md` for the complete trust and provenance model.
