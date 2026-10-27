# Boot Inspection

Inspection-analytics web app for automated optical inspection (AOI) on PCB
assembly lines: stations post every board they inspect, operators work
through the boards the machine flagged, and engineers watch yield, false
calls and where defects land on each board type.

**Stack:** Spring Boot 4.1 (Java 21) · PostgreSQL 16 · React + TypeScript · Docker · GitHub Actions

> Work in progress. This README is filled in as each part lands.

## Repository layout

| Path | What |
|---|---|
| `api/` | Spring Boot REST API, Flyway migrations, integration tests against PostgreSQL |
| `tools/generator/` | Seeded generator for realistic synthetic AOI data (TypeScript) |
| `db/check_rollups.sql` | Checks the incremental rollups against a full rebuild on a loaded database |
| `docs/openapi.yaml` | API contract |
