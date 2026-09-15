# 🚀 Backend Mastery & Learning Roadmap: Bếp Phương API

This roadmap is designed as a practical, step-by-step implementation guide to expand the [api](file:///Users/kiennt2/recipes/api) codebase from a standard REST API into an enterprise-grade backend system. 

Each phase includes:
- **Concept & Problem**: Why this is essential in real-world systems.
- **Implementation Spec**: Exactly what to build and where in this codebase.
- **Verification & Acceptance Criteria**: How to test that your implementation is working.

---

## 📑 Table of Contents
- [Current Architecture Baseline](#current-architecture-baseline)
- [Phase 1: Database Integrity, Transactions & Search](#phase-1-database-integrity-transactions--search)
- [Phase 2: Advanced Authentication & Security](#phase-2-advanced-authentication--security)
- [Phase 3: High-Performance Caching & Distributed Queues](#phase-3-high-performance-caching--distributed-queues)
- [Phase 4: Real-time Communication & Webhooks](#phase-4-real-time-communication--webhooks)
- [Phase 5: Observability, Testing & DevOps (SRE)](#phase-5-observability-testing--devops-sre)
- [Progress Tracking Checklist](#progress-tracking-checklist)

---

## 🏛 Current Architecture Baseline

```
api/
├── db/schema.sql               # Database schema (PostgreSQL)
├── src/
│   ├── config/                 # Database (pg Pool), Env vars
│   ├── controllers/            # Request handlers & responses
│   ├── docs/                   # Zod to OpenAPI / Swagger UI
│   ├── jobs/                   # node-cron scheduled syncs
│   ├── middlewares/            # Auth, validation, error handler, rate limit
│   ├── repositories/           # Raw SQL parameterized queries
│   ├── routes/                 # Express routers
│   ├── schemas/                # Zod validation schemas
│   ├── services/               # Business logic
│   ├── types/                  # TypeScript interfaces
│   ├── utils/                  # AppError, Logger
│   ├── app.ts                  # Express application setup
│   └── server.ts               # Server entry point
```

---

## 📦 Phase 1: Database Integrity, Migrations & Search

> [!NOTE]
> **Already Implemented in Codebase**:
> - ✅ **ACID Database Transactions**: [createRecipe](file:///Users/kiennt2/recipes/api/src/repositories/recipe.repository.ts#L136-L196), [updateRecipe](file:///Users/kiennt2/recipes/api/src/repositories/recipe.repository.ts#L198-L263), and [batchIncrementRecipeViewCounts](file:///Users/kiennt2/recipes/api/src/repositories/recipe.repository.ts#L318-L344) already properly use `pool.connect()`, `BEGIN`, `COMMIT`, `ROLLBACK`, and `finally { client.release() }`.

### 1.1 Soft Deletes & Audit Logging
- **Problem**: Hard-deleting recipes (`DELETE FROM recipes`) immediately destroys user data, analytics history, and breaks foreign relations. Accidental deletion cannot be undone.
- **Files to Modify/Create**:
  - [schema.sql](file:///Users/kiennt2/recipes/api/db/schema.sql) (or migration)
  - [recipe.repository.ts](file:///Users/kiennt2/recipes/api/src/repositories/recipe.repository.ts)
  - [recipe.service.ts](file:///Users/kiennt2/recipes/api/src/services/recipe.service.ts)
- **Implementation Steps**:
  1. Add `deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL` column to `recipes` table.
  2. Add index: `CREATE INDEX idx_recipes_deleted_at ON recipes (deleted_at) WHERE deleted_at IS NULL;` (Partial Index for fast active queries).
  3. Modify `deleteRecipe()` to perform a soft delete: `UPDATE recipes SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`.
  4. Modify `findAllRecipes()` and `findRecipeById()` to filter `WHERE deleted_at IS NULL`.
  5. Add an Admin-only endpoint `POST /api/recipes/:id/restore` to un-delete a recipe.
- **Verification**:
  - Delete a recipe, verify it disappears from public listings, then verify the record still exists in the database with `deleted_at` populated, and restore it successfully via admin endpoint.

---

### 1.2 Automated Schema Migrations (`node-pg-migrate`)
- **Problem**: Manually running `schema.sql` doesn't support versioning, team collaboration, or rollbacks across staging/production.
- **Files to Modify/Create**:
  - `package.json` (add `node-pg-migrate`, migration scripts)
  - `migrations/` directory
- **Implementation Steps**:
  1. Install `node-pg-migrate` and configure it in `package.json`.
  2. Write initial migration: `001_initial_schema.sql` (or `.ts`) with `up` and `down` actions.
  3. Create subsequent migrations (e.g., `002_add_refresh_tokens_table.sql`).
  4. Add scripts: `"migrate:up": "node-pg-migrate up"` and `"migrate:down": "node-pg-migrate down"`.
- **Verification**:
  - Run `npm run migrate:up` on a clean DB, check tables, then run `npm run migrate:down` and confirm rollback.

---

### 1.3 Full-Text Search (FTS) with PostgreSQL
- **Problem**: `ILIKE '%query%'` cannot use standard B-Tree indexes efficiently and doesn't handle language stemming or word ranking.
- **Files to Modify/Create**:
  - [schema.sql](file:///Users/kiennt2/recipes/api/db/schema.sql) (or a migration)
  - [recipe.repository.ts](file:///Users/kiennt2/recipes/api/src/repositories/recipe.repository.ts)
- **Implementation Steps**:
  1. Add a generated `tsvector` column or GIN index for search:
     ```sql
     CREATE INDEX idx_recipes_fts ON recipes USING GIN (to_tsvector('simple', unaccent(title) || ' ' || unaccent(description)));
     ```
  2. Implement search query with `plainto_tsquery` or `phraseto_tsquery` and calculate relevance rank with `ts_rank()`.
- **Verification**:
  - Test searching multi-word queries (e.g. `"bún bò huế cay"`) and verify results are sorted by relevance rank.

---

## 🔐 Phase 2: Advanced Authentication & Security

### 2.1 Refresh Token Rotation & Session Management ✅ *(Completed)*
- **Problem**: Long-lived access tokens cannot be revoked if stolen. Short-lived access tokens without refresh tokens force users to re-login repeatedly.
- **Files to Modify/Create**:
  - `src/types/auth.type.ts`
  - `src/services/user.service.ts`
  - `src/repositories/session.repository.ts`
  - [auth.ts](file:///Users/kiennt2/recipes/api/src/middlewares/auth.ts)
- **Implementation Steps**:
  1. Create a `refresh_tokens` table (or Redis store) storing: `id`, `user_id`, `token_hash`, `device_info`, `expires_at`, `is_revoked`.
  2. Access Token TTL: **15 minutes** (sent in response JSON or Authorization header).
  3. Refresh Token TTL: **7 - 30 days** (stored in `httpOnly`, `Secure`, `SameSite=Strict` cookie).
  4. Endpoint `POST /api/users/refresh`:
     - Verifies refresh token.
     - Revokes old token and issues a **new** pair (Token Rotation).
     - If an already-revoked refresh token is reused, revoke **all** tokens for that user (Automatic Reuse Detection / Breach Defense).
  5. Endpoint `POST /api/users/logout`: Revokes the current session refresh token.
- **Verification**:
  - Test token refreshing after 15 minutes, test logout, and verify that replaying an old refresh token invalidates the entire session chain.

---

### 2.2 Social Login with OAuth 2.0 (Google / GitHub)
- **Problem**: Users prefer one-click authentication without managing separate passwords.
- **Files to Modify/Create**:
  - `src/controllers/auth.controller.ts`
  - `src/services/oauth.service.ts`
  - `src/routes/user.route.ts`
- **Implementation Steps**:
  1. Generate Google OAuth authorization URL with `state` parameter (CSRF protection).
  2. Handle callback `GET /api/users/oauth/google/callback`:
     - Exchange `code` for Google tokens via Google OAuth2 API.
     - Fetch profile (email, name, avatar).
     - Find or create user in DB (mark `is_email_verified = true`).
     - Issue access + refresh tokens and redirect to frontend.
- **Verification**:
  - Log in via Google account, verify that user record is created/linked and JWT is returned.

---

### 2.3 HTTP Security Hardening ✅ *(Completed)*
- **Problem**: Missing HTTP security headers, unrestricted payload sizes, and open endpoints expose the API to XSS, clickjacking, and DoS.
- **Files to Modify/Create**:
  - [app.ts](file:///Users/kiennt2/recipes/api/src/app.ts)
- **Implementation Steps**:
  1. Install and configure `helmet`:
     ```ts
     import helmet from "helmet"
     app.use(helmet())
     ```
  2. Configure strict CORS allowing only specific frontend origin(s).
  3. Set strict JSON body size limits (`express.json({ limit: "10kb" })`).
- **Verification**:
  - Inspect response headers using `curl -I http://localhost:3000/api/recipes` and verify headers like `X-Content-Type-Options`, `Strict-Transport-Security`, and `X-Frame-Options`.

---

## ⚡ Phase 3: High-Performance Caching & Distributed Queues

### 3.1 Cache-Aside Pattern with Redis
- **Problem**: Frequently accessed, rarely changed endpoints (e.g. `GET /api/categories`, `GET /api/recipes/popular`) overload the relational database.
- **Files to Modify/Create**:
  - `src/config/redis.ts`
  - [category.service.ts](file:///Users/kiennt2/recipes/api/src/services/category.service.ts)
  - [recipe.service.ts](file:///Users/kiennt2/recipes/api/src/services/recipe.service.ts)
- **Implementation Steps**:
  1. Define a generic caching utility `getOrSetCache(key, ttl, fetcher)`.
  2. In `getAllCategories()`:
     - Check `redis.get("categories:all")`.
     - If hit: return cached JSON.
     - If miss: query Postgres, store in Redis with TTL (e.g. 1 hour), and return.
  3. **Cache Invalidation**: When an admin creates/updates/deletes a category, invalidate `categories:all`.
- **Verification**:
  - Monitor response time on second request (should drop from ~50ms to <2ms), and confirm cache auto-refreshes when a category is modified.

---

### 3.2 Distributed Background Job Queue with BullMQ
- **Problem**: Sending emails synchronously or processing uploaded images inside the HTTP request loop causes timeouts and poor user experience.
- **Files to Modify/Create**:
  - `src/queues/email.queue.ts`
  - `src/workers/email.worker.ts`
  - `src/workers/image.worker.ts`
- **Implementation Steps**:
  1. Install `bullmq` and `ioredis`.
  2. Create an `emailQueue` for async email delivery (OTP, verification, approval notices).
  3. Create an `imageQueue` for generating WebP thumbnails / uploading to Cloudinary in the background.
  4. Configure automatic retries with exponential backoff (e.g. 3 attempts, 5s delay).
  5. Set up a separate worker process or entry point (`src/worker.ts`).
- **Verification**:
  - Trigger user registration and confirm the API responds immediately (<100ms) while the email is sent in the background worker.

---

## 📡 Phase 4: Real-time Communication & Webhooks

### 4.1 Server-Sent Events (SSE) or WebSockets
- **Problem**: Users have to refresh the page to know if their recipe submission has been approved or rejected by an admin.
- **Files to Modify/Create**:
  - `src/routes/notification.router.ts`
  - `src/services/notification.service.ts`
- **Implementation Steps**:
  1. Create SSE endpoint `GET /api/notifications/stream`:
     - Maintain active client response streams in memory / Redis pub-sub.
     - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
  2. When an admin approves/rejects a recipe:
     - Publish notification event: `{ type: "RECIPE_APPROVED", recipeId, message }`.
     - Push SSE payload to the author's connected stream.
- **Verification**:
  - Connect via browser `EventSource` or `curl -N http://localhost:3000/api/notifications/stream`, approve a recipe from admin panel, and observe real-time event.

---

### 4.2 Webhook Engine (Inbound & Outbound)
- **Problem**: External systems need to trigger workflows in your backend, and third-party consumers want automated event updates.
- **Files to Modify/Create**:
  - `src/controllers/webhook.controller.ts`
  - `src/routes/webhook.router.ts`
  - `src/utils/signature.ts`
- **Implementation Steps**:
  1. **Inbound Webhooks**:
     - Handle Cloudinary or Stripe/Payment webhooks.
     - Implement HMAC-SHA256 signature verification to ensure requests originate from trusted sources.
  2. **Outbound Webhooks**:
     - Allow admins to register external webhook URLs.
     - Send POST requests with payload + HMAC signature header (`X-Hub-Signature-256`) when events occur (`recipe.created`).
- **Verification**:
  - Trigger webhook with valid signature -> 200 OK. Trigger with invalid signature -> 401 Unauthorized.

---

## 🛠 Phase 5: Observability, Testing & DevOps (SRE)

### 5.1 Request Tracing & Correlation IDs
- **Problem**: In distributed systems, debugging an error without a request identifier across logs is nearly impossible.
- **Files to Modify/Create**:
  - `src/middlewares/requestId.ts`
  - [logger.ts](file:///Users/kiennt2/recipes/api/src/utils/logger.ts)
- **Implementation Steps**:
  1. Extract incoming `X-Request-ID` or generate a new `crypto.randomUUID()`.
  2. Attach `req.id` and echo it back in the response header `X-Request-ID`.
  3. Format all log entries as structured JSON containing `requestId`, `method`, `url`, `statusCode`, `durationMs`.
- **Verification**:
  - Send request with `curl -H "X-Request-ID: test-123" http://localhost:3000/api/recipes` and verify logs and response headers contain `test-123`.

---

### 5.2 Health Checks & Prometheus Metrics
- **Problem**: Monitoring systems and cloud hosts need to evaluate whether the application is alive and ready to accept traffic.
- **Files to Modify/Create**:
  - `src/routes/health.router.ts`
  - `src/metrics/prometheus.ts`
- **Implementation Steps**:
  1. `GET /health/live`: Returns `{ status: "ok" }` if HTTP server is responsive.
  2. `GET /health/ready`: Executes `SELECT 1` on PostgreSQL and `PING` on Redis; returns 503 if any dependency is down.
  3. Install `prom-client` and expose `GET /metrics` with default NodeJS metrics + HTTP request duration histograms.
- **Verification**:
  - Stop PostgreSQL service locally and verify `/health/ready` immediately returns HTTP 503 with details.

---

### 5.3 Automated Testing (Unit & Integration)
- **Problem**: Code refactors can silently break APIs without test coverage.
- **Files to Modify/Create**:
  - `vitest.config.ts` (or `jest.config.ts`)
  - `tests/unit/recipe.service.test.ts`
  - `tests/integration/recipe.api.test.ts`
- **Implementation Steps**:
  1. Set up Vitest + Supertest.
  2. **Unit Tests**: Test business logic (slug generation, calculation, validation) with mocked repository calls.
  3. **Integration Tests**: Execute real HTTP calls via Supertest against an ephemeral test PostgreSQL database to verify full request-response lifecycle.
- **Verification**:
  - Run `npm test` and achieve >80% code coverage on core services and routes.

---

### 5.4 Containerization with Docker & Docker Compose
- **Problem**: "It works on my machine" issues due to mismatched Node, PostgreSQL, or Redis versions.
- **Files to Modify/Create**:
  - `Dockerfile` (Multi-stage build)
  - `docker-compose.yml`
  - `.dockerignore`
- **Implementation Steps**:
  1. Multi-stage `Dockerfile`:
     - Stage 1: Build & compile TypeScript (`tsup`).
     - Stage 2: Production runtime with minimal Node alpine image.
  2. `docker-compose.yml` defining services:
     - `api`: Node.js app
     - `db`: PostgreSQL 16
     - `redis`: Redis 7
     - `worker`: BullMQ background worker
- **Verification**:
  - Run `docker compose up --build` and verify the entire backend stack runs smoothly from scratch.

---

## 📋 Progress Tracking Checklist

Use this checklist to track your learning and implementation progress:

### Phase 1: Database & Migrations
- [x] Implement ACID database transaction for recipe creation/update (`BEGIN`/`COMMIT`/`ROLLBACK`) *(Already Done)*
- [ ] Implement Soft Deletes (`deleted_at`, partial indexing, and restore endpoint)
- [ ] Set up `node-pg-migrate` with `up`/`down` scripts
- [ ] Implement PostgreSQL Full-Text Search (`tsvector` + GIN Index)

### Phase 2: Advanced Auth & Security
- [x] Implement Refresh Token Rotation + httpOnly cookie session management
- [x] Implement Token Reuse Detection (automatic session purge on breach)
- [x] Add Google OAuth 2.0 social login flow *(Already Done)*
- [x] Configure `helmet` and strict CORS / payload size controls

### Phase 3: Caching & Distributed Queues
- [ ] Implement Redis Cache-Aside pattern for categories and popular recipes
- [ ] Implement event-driven cache invalidation
- [ ] Integrate BullMQ for background email sending & image processing

### Phase 4: Real-Time & Webhooks
- [ ] Implement Server-Sent Events (SSE) for recipe approval notifications
- [ ] Build Webhook endpoint with HMAC-SHA256 signature verification

### Phase 5: Observability, Testing & DevOps
- [ ] Add Request ID middleware and structured JSON logging
- [ ] Implement `/health/live`, `/health/ready`, and `/metrics` (Prometheus)
- [ ] Write Unit and Integration tests with Vitest & Supertest
- [ ] Create multi-stage `Dockerfile` and `docker-compose.yml`
