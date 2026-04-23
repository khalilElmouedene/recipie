# Security Hardening Plan (Layered)

Last reviewed: 2026-04-21
Scope: `backend/` + `frontend/` in this repository

## 1) Current Security Controls Already Present

- JWT authentication with expiry (`backend/app/auth.py`).
- Role and project membership checks are implemented in many routes via `check_project_access` (`backend/app/dependencies.py`).
- Password hashing with `bcrypt`.
- Encryption at rest for sensitive credentials via Fernet (`backend/app/crypto.py`).
- Some security headers are set (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) in `backend/main.py`.
- Basic auth rate limiting on register/login (`backend/app/routes/auth.py`).
- SSRF pre-check for URL fetches using `_is_safe_url` (`backend/app/routes/recipes.py`).
- Upload size/type checks in multiple upload routes (`backend/app/routes/sites.py`, `backend/app/routes/threads.py`).
- Audit logging with sensitive field redaction (`backend/app/audit.py`).

These are a good base. The main opportunity now is adding stronger defense-in-depth layers and closing a few high-impact gaps.

## 2) Key Findings (Prioritized)

## Critical

1. Missing project authorization checks in Pinterest project-scoped routes
- Evidence: `backend/app/routes/pinterest.py` uses `project_id` directly (query/body) and reads/writes `ProjectCredential` without `check_project_access`.
- Risk: authenticated user could target another project ID (IDOR / privilege escalation).
- Recommendation: enforce `check_project_access(project_id, user, db)` (admin where needed) in every Pinterest route before DB reads/writes.

## High

2. Access token stored in `localStorage`
- Evidence: `frontend/src/lib/auth.ts`.
- Risk: XSS can exfiltrate bearer token.
- Recommendation: move auth to secure HttpOnly cookies (access + refresh pattern), with short-lived access tokens and refresh token rotation.

3. Token in URL query is accepted for downloads/proxy
- Evidence: `get_current_user_download` in `backend/app/dependencies.py`.
- Risk: token leakage via browser history, logs, referrers.
- Recommendation: replace with short-lived signed one-time download/proxy token, or use authorized POST + streamed response.

4. Remote image fetch paths can load full remote content into memory without strict max size
- Evidence: `/api/image-proxy` in `backend/app/routes/recipes.py` and `/upload-from-url` in `backend/app/routes/sites.py`.
- Risk: memory/DoS via large payloads or slow responses.
- Recommendation: enforce response size caps while streaming (stop after threshold), stricter timeouts, and content-length precheck.

5. Weak JWT secret only logs warning
- Evidence: `backend/app/config.py` warns but does not fail startup.
- Risk: accidental production startup with weak/default secret.
- Recommendation: fail fast in production if JWT secret is default/weak.

## Medium

6. Missing CSP and HSTS headers
- Evidence: `backend/main.py` currently sets several headers but not CSP/HSTS.
- Risk: weaker browser-side protection against XSS/mixed content/downgrade attacks.
- Recommendation: add CSP (start with report-only) and enforce HSTS at edge/proxy.

7. Rate limiting is narrow
- Evidence: auth has limits; most mutation endpoints do not.
- Risk: abuse, brute-force, and resource exhaustion.
- Recommendation: add route-group limits (auth, upload, publish, OAuth callback, proxy) and per-user limits where possible.

8. Error detail leakage from upstream providers
- Evidence: examples include returning `response.text` or raw exception strings in some routes.
- Risk: information disclosure of internals/upstream details.
- Recommendation: sanitize outward error messages; keep full details in structured server logs only.

## 3) Layered Security Model to Add

## Layer A: Identity and Session Security

- Adopt cookie-based auth:
  - `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` where possible).
  - Access token 10-15 min max.
  - Refresh token rotation with server-side revocation list (jti/session table).
- Add logout invalidation and "logout all sessions".
- Add optional MFA for owner/admin roles.

## Layer B: Authorization and Data Access

- Standardize per-route authorization guard policy:
  - Project-scoped route -> must call `check_project_access`.
  - Admin-only mutation route -> call with `require_roles=[admin]`.
- Add automated tests for authorization matrix:
  - owner/admin/member/non-member for each project-scoped endpoint.

## Layer C: Input, Upload, and SSRF Hardening

- Keep `_is_safe_url`, and add:
  - explicit allowlist for remote image hostnames if possible.
  - response size limits for proxy/fetch routes.
  - stricter content-type + magic-byte validation.
  - block redirects to private IPs after initial check.
- Add image processing sandbox/timeouts for expensive transforms.

## Layer D: Transport and Browser Hardening

- Add CSP header (start report-only):
  - restrict `script-src`, `img-src`, `connect-src`, `frame-ancestors`.
- Add HSTS at reverse proxy/load balancer.
- Keep `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`.
- Restrict CORS origins strictly per environment (never wildcard in prod).

## Layer E: Secrets and Key Management

- Enforce strong secrets in production at startup:
  - JWT secret length/entropy gate.
  - ENCRYPTION_KEY present and valid.
- Move secrets from plain env to secret manager (Vault/AWS/GCP/Azure) for production.
- Define key rotation runbook:
  - Fernet key rotation strategy.
  - JWT signing key rotation with overlap window.

## Layer F: Abuse Prevention and Stability

- Add global + per-route throttles for:
  - login/register/setup-password,
  - publish flows,
  - image proxy/upload-from-url,
  - OAuth callbacks.
- Add request body size limits and async timeouts consistently.
- Add queue limits/concurrency caps for expensive background operations.

## Layer G: Observability and Incident Response

- Structured security logs:
  - auth failures, permission denials, unusual upload/proxy behavior.
- Security alerting thresholds:
  - brute-force patterns, high 4xx/5xx spikes, token failures.
- Incident runbooks:
  - compromised token response,
  - credential leak response,
  - forced key rotation procedure.

## 4) 30 / 60 / 90 Day Execution Plan

## First 30 days (P0)

1. Fix Pinterest route authorization checks.
2. Enforce startup failure for weak JWT secret in production.
3. Add response-size cap and safer streaming for image proxy/upload-from-url.
4. Remove raw upstream error details from API responses.
5. Add rate limits to proxy/upload/publish endpoints.

## 31-60 days (P1)

1. Migrate from `localStorage` token to HttpOnly cookie auth model.
2. Replace URL-query token download pattern with short-lived signed download tokens.
3. Add CSP in report-only mode, then enforce.
4. Add authorization integration tests for every project-scoped endpoint.

## 61-90 days (P2)

1. Refresh token rotation + session revocation table.
2. MFA for privileged roles.
3. Secret manager integration and key rotation automation.
4. Security monitoring dashboards + alert rules + runbooks.

## 4.1) Implementation Status (2026-04-21)

Completed in code:

- Pinterest route authorization checks added for project-scoped operations (`backend/app/routes/pinterest.py`).
- Production startup now fails fast for weak/default JWT secret (`backend/app/config.py`).
- Remote image fetch/proxy routes now enforce hard byte caps and streaming guards (`backend/app/routes/recipes.py`, `backend/app/routes/sites.py`).
- Additional route rate limits added for proxy/upload/publish/job-trigger paths (`backend/app/routes/recipes.py`, `backend/app/routes/sites.py`, `backend/app/routes/projects.py`, `backend/app/routes/jobs.py`).
- Raw upstream/provider error details reduced in Pinterest and WordPress publish flows (`backend/app/routes/pinterest.py`, `backend/app/services/pinterest.py`, `backend/app/routes/recipes.py`, `backend/app/routes/projects.py`).
- Cookie-based auth migrated to HttpOnly cookies for auth/session (backend cookie set/clear + frontend credentialed requests) (`backend/app/routes/auth.py`, `backend/app/dependencies.py`, `frontend/src/lib/api.ts`).
- Query-token auth for download/proxy dependency removed (`backend/app/dependencies.py`).
- CSP and HSTS headers added in security middleware (`backend/main.py`).
- Security regression checks added to CI (`.github/workflows/security-hardening.yml`, `backend/tests/test_security_hardening.py`).

Still planned (not yet completed):

- Full authorization matrix tests across all project-scoped endpoints.
- Refresh token rotation + revocation and MFA rollout.

## 5) Practical Acceptance Checklist

- [ ] No project-scoped route accesses project data without `check_project_access`.
- [x] Production startup fails when JWT secret is weak/default.
- [x] Remote URL ingestion routes enforce hard byte limits and strict timeouts.
- [ ] No API response leaks raw provider/internal exceptions.
- [x] Auth/session no longer depends on `localStorage` bearer token.
- [x] Query-string token usage is removed or strictly short-lived and one-time.
- [x] CSP + HSTS are deployed in production.
- [x] Security-focused integration tests run in CI.
