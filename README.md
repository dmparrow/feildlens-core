# FieldLens Core

FieldLens Core is the reusable, local-first capture engine extracted from the FieldLens prototype.

It provides browser-based barcode capture, EAN pallet verification, carton-label OCR/conformity workflows, offline IndexedDB storage, device/orientation handling, and PWA support without requiring a hosted backend.

## Goals

- Keep capture workflows usable offline.
- Keep scanner, OCR, validation, and persistence logic independent from any specific backend.
- Expose clear integration seams for APIs, ERPs, databases, and other providers.
- Avoid shipping service credentials or infrastructure-specific configuration in the browser.

## Stack

- React + TypeScript + Vite
- Dexie / IndexedDB
- ZXing
- Three.js
- Vite PWA
- Vitest

## Development

```bash
npm install
npm run dev
```

Camera access requires HTTPS except on `localhost`.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Local-first model

```text
capture workflow
      ↓
 IndexedDB
      ↓
integration boundary
  ├─ API / database
  ├─ ERP
  ├─ reporting
  └─ custom provider
```

The public core intentionally contains no deployment-specific configuration and no direct account integration. Production hosts can add authentication, remote persistence, sync/outbox processing, tenancy, and provider adapters without making capture dependent on network availability.

## Origin

Extracted from the private `dmparrow/net` FieldLens prototype. That repository remains unchanged and separate from this public core.
