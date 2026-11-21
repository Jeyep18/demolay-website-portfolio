# Supabase PostgreSQL trust root

`prod-ca-2021.crt` is a **public CA certificate**, not a private key. It was downloaded on 18 October 2026 from the certificate link in the authenticated DeMolay project's Database → Settings → SSL configuration page:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Its SHA-256 fingerprint is `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; it expires on 26 April 2031. The original PEM file's SHA-256 is `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

The backup workflow supplies this file through `PGSSLROOTCERT`. Existing `sslmode=verify-full` still validates the server chain and hostname. It is scoped to the PostgreSQL clients, not installed into the operating system's trust store. Review a provider certificate rotation through the same official dashboard source, update the pinned fingerprint test, and rerun the hosted connection preflight before relying on the replacement.

See [Supabase SSL verification instructions](https://supabase.com/docs/guides/platform/ssl-enforcement). The pooler's private CA is not covered by a default public system trust store.
