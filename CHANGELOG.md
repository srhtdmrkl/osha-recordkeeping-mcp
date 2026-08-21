# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-08-21

### Added

- Initial release of the OSHA Recordkeeping MCP server (29 CFR Part 1904).
- 11 deterministic triage tools, 15 bundled regulatory datasets, and companion skill (`osha-incident-triage`).
- Multi-transport execution support: stdio (Claude Desktop), Node HTTP, and Cloudflare Workers (`workerd`).
- Security controls: Host/Origin allowlisting (`src/httpGuard.ts`), request body size caps, and Cloudflare Worker IP rate limiting (`[[ratelimits]]`).
- Built-in data provenance with build-breaking regulatory staleness decay trap (`scripts/check-decay.ts`).
- Behavioral evaluation suite (`evals/recordkeeping-evals.xml`) covering 47 recordkeeping test cases.

### Regulatory data

- All 15 datasets verified against eCFR (current as of 2026-08-21).