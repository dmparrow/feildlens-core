# Arrowstack Integration Plan

This document describes the planned path from the public, local-first FieldLens Core to a production FieldLens application running on Arrowstack.

The core repository stays reusable and infrastructure-neutral. Arrowstack-specific authentication, remote persistence, tenancy, integrations, deployment configuration, and operational tooling should live in the host application or deployment layer rather than being coupled into capture logic.

## Target architecture

```text
                         Arrowstack
                            │
                       Keycloak OIDC
                            │
                            ▼
┌──────────────────────────────────────────────┐
│                FieldLens PWA                 │
│                                              │
│ React / Vite                                 │
│ barcode scanner                              │
│ EAN pallet verification                      │
│ carton-label OCR / conformity                │
│ IndexedDB                                    │
│                                              │
│ local records ───────► durable sync outbox   │
└──────────────────────────┬───────────────────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────┐
│               FieldLens API                  │
│                                              │
│ JWT validation / RBAC                        │
│ sync ingestion                               │
│ pallet sessions                              │
│ stations / devices                           │
│ reference-data provider boundary             │
│ integration adapters                         │
└──────────────────────────┬───────────────────┘
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
             PostgreSQL          integrations
                                    │
                          ┌─────────┼─────────┐
                          ▼         ▼         ▼
                         ERP     reporting    MCP
```

## Design principles

1. **Offline capture remains authoritative during operation.** Scanner, EAN, and OCR workflows must continue functioning without network access.
2. **Remote persistence is additive.** A failed login refresh, unavailable API, database outage, or integration outage must not stop local capture.
3. **No infrastructure secrets reach the browser.** Database, ERP, MCP, deployment, and provider credentials remain server-side.
4. **Sync is idempotent.** Replaying an outbox item must never create duplicate server records.
5. **The core stays portable.** Arrowstack integration should wrap or extend FieldLens Core rather than fork scanner logic.
6. **Human and machine authentication stay separate.** Browser sessions use OIDC Authorization Code + PKCE; service-to-service integrations use dedicated machine identities.
7. **Production deployment stays portable.** Container images should work under Arrowstack's current application platform and a later Kubernetes deployment without application redesign.

## Repository boundary

FieldLens Core should continue to contain:

- barcode decoding and validation
- camera/device handling
- EAN pallet logic
- label detection and OCR
- conformity calculations
- IndexedDB persistence
- offline UX
- provider interfaces
- pure tests

The Arrowstack host application should own:

- Keycloak configuration
- API implementation
- PostgreSQL persistence
- tenancy and RBAC
- sync/outbox transport
- station/device registration
- server-side integrations
- Docker/runtime configuration
- deployment manifests
- secrets
- monitoring and audit data

A likely production repository layout is:

```text
fieldlens/
├── apps/
│   ├── web/
│   │   └── consumes FieldLens Core
│   └── api/
│       ├── auth/
│       ├── sync/
│       ├── scans/
│       ├── pallets/
│       ├── stations/
│       └── integrations/
├── packages/
│   ├── contracts/
│   └── fieldlens-core/
├── migrations/
├── Dockerfile
└── README.md
```

The core can initially be consumed from Git and later published as a package if that becomes useful.

## Phase 1 — Stable core boundary

Goal: make the current browser application explicitly integration-neutral.

### Work

- Keep capture records written locally first.
- Preserve generated UUIDs as stable record identifiers.
- Remove direct service-specific sync from scanner code.
- Keep external reference lookups behind the provider registry.
- Define shared serializable contracts for scans, pallet sessions, OCR observations, and conformity results.
- Add schema/version information to records that will cross the network boundary.

### Acceptance criteria

- All existing capture workflows work with no backend configured.
- Tests, lint, and build pass.
- No remote provider is required to start or complete a scan.
- Public core contains no deployment credentials or account-specific integration secrets.

## Phase 2 — Durable sync outbox

Goal: make browser-to-server synchronization reliable and retry-safe.

The local model should evolve from a simple local/synced flag into an explicit outbox.

```text
capture
   │
   ▼
IndexedDB transaction
   ├── domain record
   └── outbox event
            │
            ▼
      connectivity available
            │
            ▼
       batch sync request
            │
            ▼
      idempotent API write
            │
            ▼
     acknowledge event IDs
            │
            ▼
      mark local events sent
```

### Suggested outbox record

```ts
type OutboxRecord = {
  id: string
  aggregateId: string
  eventType: string
  schemaVersion: number
  payload: unknown
  createdAt: string
  attempts: number
  nextAttemptAt?: string
  syncedAt?: string
}
```

### API shape

```http
POST /api/v1/sync
Authorization: Bearer <access-token>
Content-Type: application/json
```

Example request:

```json
{
  "deviceId": "device-uuid",
  "events": [
    {
      "id": "event-uuid",
      "eventType": "scan.captured",
      "schemaVersion": 1,
      "payload": {}
    }
  ]
}
```

The server should use the event ID or domain record UUID as an idempotency key.

### Acceptance criteria

- Offline scans queue without error.
- Reconnecting automatically resumes sync.
- Replaying the same batch is safe.
- Partial batch failure does not lose successful acknowledgements.
- Operators can see pending/synced/error state without being blocked by it.

## Phase 3 — Arrowstack authentication

Goal: authenticate humans and machines without changing offline capture behavior.

### Browser authentication

Use Keycloak:

- Authorization Code flow
- PKCE
- short-lived access tokens
- refresh/session handling outside scanner logic
- API validates issuer, signature, expiry, and intended audience/client

The PWA should be able to launch and operate locally even when an existing authenticated session cannot immediately refresh. Remote sync waits until authentication is available.

### Machine authentication

Server-side integrations should use dedicated Keycloak service accounts and `client_credentials`.

Examples:

- FieldLens API to another Arrowstack service
- Arrowstack MCP to FieldLens API
- background integration workers

Machine credentials must never be exposed to the PWA.

### Initial roles

A minimal role model could be:

```text
fieldlens-operator
fieldlens-supervisor
fieldlens-admin
fieldlens-integration
```

Role enforcement belongs at the API boundary.

## Phase 4 — PostgreSQL data model

Goal: make synchronized capture data centrally queryable and auditable.

### Core hierarchy

```text
tenant
 └── site
      └── station
           └── device
                └── scan events
```

### Suggested entities

#### tenants

- id
- name
- created_at

#### sites

- id
- tenant_id
- name
- timezone
- created_at

#### stations

- id
- site_id
- name
- station_type
- active
- created_at

#### devices

- id
- station_id
- installation_id
- label
- last_seen_at
- app_version

#### scans

- id
- tenant_id
- site_id
- station_id
- device_id
- operator_subject
- raw_value
- format
- duplicate
- captured_at
- received_at
- schema_version

#### pallet_sessions

- id
- tenant_id
- site_id
- station_id
- device_id
- operator_subject
- workflow_type
- target_count
- started_at
- completed_at
- status
- conforms
- result_status

#### pallet_observations

- id
- pallet_session_id
- carton_index
- ean
- fields_json
- raw_text
- confidence
- captured_at

#### pallet_exceptions

- id
- pallet_session_id
- observation_id
- field
- expected_value
- actual_value
- exception_type

### Data ownership

Tenant/site/station identity should be derived from trusted server-side registration and token context where possible, rather than accepting arbitrary tenant identifiers from the browser.

## Phase 5 — Device and station registration

Goal: make a PWA installation identifiable without turning device identity into a secret.

On first run:

1. Generate a persistent installation UUID.
2. Store it in IndexedDB.
3. After login, register it with the API.
4. An authorized user assigns or confirms its station.
5. The API returns non-secret station metadata.
6. Every synced event includes the installation UUID.

A reset browser/device can register as a new installation without affecting historical records.

## Phase 6 — Reference-data providers

Goal: move environment-specific expected-label lookups behind server-side adapters.

FieldLens Core already exposes a provider boundary. The Arrowstack host can supply a provider backed by:

- PostgreSQL
- ERP API
- sorter/packhouse database
- Google Sheets
- another Arrowstack service
- a cached reference dataset

Preferred production flow:

```text
FieldLens Core
     │
     ▼
host provider
     │
     ▼
FieldLens API
     │
     ├── cached reference data
     ├── ERP adapter
     └── other server-side provider
```

The browser should not need provider credentials.

Reference lookup failure must degrade to local OCR/conformity rather than block the workflow.

## Phase 7 — API surface

Initial endpoints:

```http
GET  /api/health/live
GET  /api/health/ready

POST /api/v1/sync

GET  /api/v1/me
GET  /api/v1/stations
POST /api/v1/devices/register

GET  /api/v1/scans
GET  /api/v1/pallet-sessions/:id

GET  /api/v1/reference/labels/:ean
```

Administrative write endpoints should be added only when needed.

## Phase 8 — Containerisation and Arrowstack deployment

Goal: make the application deployable as a normal Arrowstack workload.

### Web

Build the Vite application into static assets and serve them from a small web image or through the API image if a single-container deployment is preferred initially.

### API

Container requirements:

- non-root runtime user
- health endpoints
- graceful shutdown
- configuration through environment variables
- no baked-in secrets
- structured logs
- database migrations as an explicit deployment step

### Database

Provision PostgreSQL through Arrowstack's tenant/database tooling.

The runtime database role should have only the permissions needed by the FieldLens database. Schema migrations should use a migration role rather than requiring broad privileges from the normal API runtime identity.

### Deployment stages

1. Build image.
2. Run tests.
3. Run migrations.
4. Deploy API.
5. Verify readiness.
6. Deploy web.
7. Run a smoke sync from a test device.
8. Promote/retain the healthy revision.

The first production target can use Arrowstack's current application deployment platform. The container contract should stay compatible with a later Kubernetes/K3s deployment.

## Phase 9 — Observability and audit

Capture at least:

- API request/error rate
- sync batch success/failure
- pending client outbox count where available
- database health
- active installations
- last-seen station/device timestamps
- application version
- reference-provider latency/failures

Do not log:

- access tokens
- authorization headers
- Keycloak client secrets
- database URLs with passwords
- provider credentials
- complete environment dumps

Audit-sensitive actions such as station reassignment, administrative corrections, and integration changes should have actor, timestamp, and before/after metadata.

## Phase 10 — Arrowstack MCP integration

FieldLens can later expose a narrow machine-facing API or MCP surface for operational tooling.

Useful read operations:

- list active stations
- summarize recent scans
- show unsynced/error conditions
- fetch pallet conformity results
- list recent exceptions

Possible controlled write operations:

- register/disable a station
- update reference data
- acknowledge or annotate an exception

Machine access should use a dedicated Keycloak client and explicit FieldLens roles. MCP access must not imply unrestricted database access.

## Delivery sequence

Recommended implementation order:

```text
1. shared contracts
2. IndexedDB outbox
3. sync client
4. API skeleton + health
5. PostgreSQL migrations
6. idempotent /sync endpoint
7. Keycloak browser auth
8. device/station registration
9. reference provider API
10. Arrowstack container deployment
11. admin/operations views
12. MCP integration
```

This sequence gets durable central data working before adding secondary integrations or dashboards.

## First production milestone

The first Arrowstack-backed release is complete when:

- the PWA installs and works offline
- scans and pallet sessions persist locally first
- users authenticate through Keycloak when online
- queued data syncs idempotently to PostgreSQL
- a device is associated with a station
- the API enforces tenant/station access
- reference lookups can be supplied by the API but are optional
- no server credentials are present in browser bundles
- application images deploy through Arrowstack
- health checks, logs, and database migrations are operational
- CI runs tests, lint, and build before deployment

At that point FieldLens is no longer a standalone scanner with optional integrations; it is a local-first Arrowstack application whose capture path remains resilient when the platform or network is unavailable.
