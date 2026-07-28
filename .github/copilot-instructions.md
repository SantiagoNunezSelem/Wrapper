# Copilot Instructions

## Repository status
- This repository currently contains product/specification documents under `Project_Context\`; there is no application source tree, package manifest, or runnable project scaffold yet.
- Treat the Markdown files in `Project_Context\` as the source of truth when generating code, plans, or future documentation.

## Build, test, and lint commands
- No build, test, or lint commands are defined in the repository yet.
- There is no `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, or equivalent project manifest at the repository root.
- Do not invent commands or toolchains. If implementation code is added later, update this file with the actual commands and include the smallest supported single-test invocation for that stack.

## High-level architecture
- The intended product is a **web application** that analyzes exported WhatsApp chats and presents the output as a **Wrapped / stories-style experience**.
- The planned stack is:
  - **Frontend:** React or Next.js, with i18n from day one for Spanish and English.
  - **Backend:** ASP.NET Core REST API in C#.
  - **Database:** PostgreSQL or SQL Server via Entity Framework Core.
  - **Auth:** Google OAuth 2.0 only.
- The core architecture is **hybrid and privacy-first**:
  1. The user uploads a WhatsApp `.txt` or `.zip` export in the browser.
  2. Parsing and metric computation happen **locally in the frontend**.
  3. Raw chat messages must **never** be sent to the backend.
  4. Only a lightweight JSON of aggregated results is sent to the backend and stored per authenticated user.
  5. Premium features that truly require external AI should send only the minimum necessary text, never the full chat, and only after backend-side entitlement checks.
- The backend is responsible for:
  - Persisting users, subscriptions, and saved analyses.
  - Enforcing PRO access on every premium request.
  - Managing payment-provider webhooks and subscription state transitions.
- Subscription access is **state-based**, not a static boolean. Model PRO access from subscription lifecycle data (`trial`, `activa`, `cancelada`, `vencida`, `pago_fallido`) rather than an `IsPro` flag.

## Key conventions
- **Privacy is a hard requirement:** future implementations must preserve the rule that chat contents stay in the browser; only aggregated metrics may be stored server-side.
- **WhatsApp export only for MVP:** support native WhatsApp `.txt` / `.zip` exports only. OCR, screenshots, and non-WhatsApp sources are explicitly out of scope.
- **Bilingual from the start:** UI copy, metric labels, loading text, parser system-message handling, and configurable dictionaries must support both Spanish and English from the MVP onward.
- **Prefer non-AI implementations first:** metrics should be computed locally whenever possible. If a metric can be implemented without AI, do that first and keep a non-AI fallback even if an AI-assisted version exists.
- **Parser requirements are broader than a single regex:** handle multiple WhatsApp export variants, multiline messages, system messages, deleted-message markers, and media markers in both supported languages.
- **Use a normalized intermediate message shape** for client-side processing, with fields equivalent to `timestamp`, `sender`, `message`, `isMedia`, and `wordCount`.
- **Blurred PRO previews must not leak data:** premium detail views should not rely on CSS-only hiding. Render blocked experiences so users cannot reveal protected content via DevTools by removing styles.
- **Detailed views are per participant:** when a metric has a detailed mode, it usually expands into rankings, timelines, heatmaps, or paginated participant-level breakdowns rather than a single global number.
- **Do not show empty premium modules:** if a PRO metric has no meaningful data for a chat, omit it instead of showing an empty blurred card.
- **Pricing must stay configurable:** monetary values should come from configuration/backoffice data, not hardcoded constants.
- **Trials are one per Google account:** future subscription logic must enforce one trial historically per user account, even if the user cancels and resubscribes later.
- **Follow the document set in this order when requirements conflict or feel incomplete:**
  1. `Project_Context\00_Resumen_Ejecutivo_y_Diferenciacion.md`
  2. `Project_Context\01_Requisitos_y_Alcance.md`
  3. `Project_Context\02_Arquitectura_Tecnica.md`
  4. `Project_Context\03_Procesamiento_Datos_y_Regex.md`
  5. `Project_Context\04_UI_UX_Diseño.md`
  6. `Project_Context\05_Monetizacion_y_Suscripciones.md`
  7. `Project_Context\06_Referencia_Competencia_The_Cringe.md`

## Primary source documents
- `Project_Context\00_Resumen_Ejecutivo_y_Diferenciacion.md`
- `Project_Context\01_Requisitos_y_Alcance.md`
- `Project_Context\02_Arquitectura_Tecnica.md`
- `Project_Context\03_Procesamiento_Datos_y_Regex.md`
- `Project_Context\04_UI_UX_Diseño.md`
- `Project_Context\05_Monetizacion_y_Suscripciones.md`
- `Project_Context\06_Referencia_Competencia_The_Cringe.md`
