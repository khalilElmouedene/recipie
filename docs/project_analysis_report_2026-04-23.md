# Project Technical and Commercial Analysis

Analysis date: 2026-04-23

## Executive Summary

This project is not a simple CRUD web app. It is a niche content-operations platform for multi-site recipe publishing, combining:

- AI-assisted content generation
- WordPress publishing and scheduling
- Pinterest content workflows
- Threads social publishing
- Custom visual pin design tools
- Spreadsheet-style research tooling
- Background jobs, real-time logs, cleanup automation, and audit trails

From an architecture and delivery perspective, it should be treated as a full product, closer to a small vertical SaaS than to a marketing website or a basic admin dashboard.

My overall conclusion:

- Business domain: AI-assisted publishing and social content automation for recipe/food content businesses
- Technical complexity: Very High
- Delivery effort: about 138-171 working days for a senior full-stack freelancer
- Fair Morocco freelance price: 180,000-380,000 MAD
- Fair international freelance price: 24,000-52,000 USD

This is the kind of project that becomes expensive not only because of the number of screens, but because of integration risk, background processing, workflow automation, and maintenance burden.

## Scope Snapshot

Observed from the repository:

| Metric | Observed Scope |
|---|---:|
| Backend source files | 88 Python files |
| Backend source size | ~14,061 lines |
| Frontend source files | 52 TS/TSX files |
| Frontend source size | ~22,427 lines |
| REST API endpoints | 112 |
| WebSocket endpoints | 1 |
| Frontend pages/routes | 31 |
| Static pages | 21 |
| Dynamic pages | 10 |
| Shared frontend components | 10 |
| Zustand stores | 2 |
| DB tables | 20 |
| Foreign keys | 25 |
| ORM relationships | 22 |
| Alembic migrations | 32 |
| Backend tests present | 11 unittest tests |

Verification performed:

- Backend tests: `python -m unittest discover -s backend/tests -v` -> passed
- Frontend build: `npm run build` -> passed
- Frontend lint: not configured yet; `npm run lint` opens Next.js interactive ESLint setup instead of running a real project lint

## 1. Project Overview

### Purpose of the application

The application is a web-based publishing operations platform built for generating, managing, and distributing recipe content across multiple WordPress sites and social channels.

Its main value proposition is:

- speeding up recipe article production with AI
- generating supporting media through Midjourney workflows
- publishing to WordPress with SEO metadata
- preparing and publishing Pinterest assets
- managing Threads social posts
- centralizing multi-project, multi-site, and multi-user workflows

### Business domain

The business domain is:

- content marketing automation
- SEO publishing operations
- social media publishing
- niche food/recipe publishing

This looks especially suited for:

- recipe blog networks
- niche content publishers
- affiliate/media operators
- small digital agencies managing multiple content sites

### Target users

From the code and role model, the target users are:

- Owner: workspace owner, billing/strategy equivalent, full control
- Admin: project manager/content lead with operational control
- Member: contributor/operator with limited project access
- Content operator: manages recipes, generation jobs, and publishing
- SEO/social manager: works on Pinterest, Threads, titles, descriptions, and schedules

This is not an end-consumer product. It is an internal B2B productivity platform.

## 2. Architecture Analysis

### Architecture pattern

The project is best described as a layered modular monolith:

- Frontend: Next.js App Router application, heavily client-driven
- Backend: FastAPI monolith split into routes, services, workers, models, and websocket handlers
- Database: PostgreSQL with SQLAlchemy async ORM and Alembic migrations
- Background processing: in-process threaded job manager plus app-start schedulers

It is not a strict Clean Architecture implementation, and it is not classic MVC either. It has good module boundaries at folder level, but the inner layers are not strongly isolated.

### Separation of concerns

Strengths:

- clear backend split between `routes`, `services`, `workers`, `db_models`, and `dependencies`
- clear frontend split between `app`, `components`, `lib`, `store`, `contexts`
- reusable API client layer in `frontend/src/lib/api.ts`
- dedicated worker and websocket logic for long-running jobs

Weaknesses:

- several route files contain substantial business logic and orchestration
- several frontend pages are extremely large and behave like mini-applications on their own
- state and data fetching are managed manually in many pages, increasing duplication

Largest maintainability hotspots:

- `frontend/src/components/PinDesigner.tsx` -> 5,493 lines
- `frontend/src/app/template-designer/page.tsx` -> 2,276 lines
- `frontend/src/app/projects/[id]/sites/[siteId]/page.tsx` -> 1,613 lines
- `frontend/src/app/threads/[id]/page.tsx` -> 1,274 lines
- `frontend/src/app/projects/[id]/spy-sheet/page.tsx` -> 1,233 lines
- `backend/app/workers/job_manager.py` -> 944 lines
- `backend/app/routes/threads.py` -> 836 lines
- `backend/app/routes/recipes.py` -> 702 lines
- `backend/app/routes/projects.py` -> 701 lines

Verdict on separation of concerns:

- Coarse-grained separation: Good
- Fine-grained separation: Moderate

### Scalability

Current scalability is acceptable for a single-instance or low-scale deployment, but not ideal for horizontal scale.

Main scalability constraints:

- running jobs are tracked in process memory inside `JobManager._running`
- websocket log streaming depends on the same app process that owns the job
- multiple schedulers start inside FastAPI lifespan at app boot
- background work is not offloaded to a dedicated external queue system

Practical implication:

- this app can work well for a single server deployment
- scaling to multiple backend instances may create duplicated scheduled work, missing job visibility, or harder operational control unless sticky routing and distributed coordination are added

### Maintainability

Maintainability is medium overall:

- strong enough to keep shipping features
- weak enough that future changes will get slower if refactoring is skipped

Main maintainability risks:

- giant files
- manual page-level state orchestration
- limited automated coverage
- mixed schema bootstrapping strategy (`create_all` + Alembic)

## 3. Backend Analysis

### Backend technology stack

- FastAPI
- SQLAlchemy asyncio
- PostgreSQL
- Alembic
- WebSockets
- HTTP-only cookie JWT auth
- Python background threads and schedulers

### Route modules and endpoint count

| Backend Module | Endpoints |
|---|---:|
| `auth` | 10 |
| `users` | 5 |
| `projects` | 16 |
| `credentials` | 2 |
| `dashboard` | 1 |
| `jobs` | 8 |
| `recipes` | 14 |
| `sites` | 8 |
| `settings` | 17 |
| `pinterest` | 6 |
| `pin_designer_templates` | 5 |
| `threads` | 17 |
| `spy_sheet` | 2 |
| `audit_logs` | 1 |
| Total REST endpoints | 112 |

Additional realtime endpoint:

- WebSocket: `/ws/logs/{job_id}`

### Main backend modules/services

Core backend service modules identified:

- `article_generator`
- `cloudinary_utils`
- `credentials_loader`
- `email_service`
- `excel_export`
- `google_sheets`
- `image_retention_scheduler`
- `midjourney`
- `openai_service`
- `pin_generator`
- `pinterest`
- `prompts`
- `publish_scheduler`
- `publisher`
- `stale_job_reconciler`
- `threads_api`
- `threads_media_cleanup_scheduler`
- `threads_scheduler`
- `wordpress`

Worker / orchestration module:

- `workers/job_manager.py`

### Authentication and authorization

Authentication is more advanced than a basic login form. The backend includes:

- JWT generation
- HTTP-only auth cookies
- Google OAuth callback flow
- password setup flow for invited users
- forgot/reset password flow
- owner-only access checks
- project-level membership checks
- project roles (`admin`, `member`)

This is a proper B2B admin auth model, not a toy implementation.

### Business logic complexity

Business logic complexity: High to Very High

Why:

- AI generation pipelines with configurable prompts
- long-running job lifecycle management
- image generation and caching
- cross-site content reuse logic
- WordPress publish scheduling and backdating
- Pinterest board, tags, title, and publish workflows
- Threads account management, scheduling, media upload, and publish flows
- cleanup and retention automation
- audit trail handling

### External integrations

The project integrates with many external systems:

- OpenAI
- Midjourney through Discord workflows
- WordPress XML-RPC
- Rank Math / Yoast SEO metadata handling
- Pinterest OAuth / API
- Threads / Meta API
- Google OAuth
- Google Sheets service account flow
- SMTP email
- Cloudinary

This is one of the biggest reasons the project deserves a high valuation. Integration-heavy products are materially harder to build and maintain than isolated internal apps.

## 4. Frontend Analysis

### Frontend technology stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Zustand
- Fabric.js

### Frontend page and component scope

Observed frontend structure:

- 31 app routes/pages
- 21 static routes
- 10 dynamic routes
- 10 shared components
- 2 Zustand stores
- 1 custom hook
- 1 context provider

### Major frontend areas

The frontend covers far more than simple admin screens:

- dashboard and project overview
- authentication and profile flows
- project and team management
- site and recipe operations
- generation job history and realtime logs
- Pinterest gallery and worksheet
- spreadsheet-like spy sheet
- Pin Designer Templates manager
- Template Designer editor
- Pin Designer editor for recipe visuals
- Threads planner, content library, analytics, and settings

### UI complexity

UI complexity: Advanced

Why:

- custom canvas-based editor for Pin Designer
- separate template designer with layers, fonts, assets, undo/history behavior
- spreadsheet-like interfaces (`Spy Sheet`, `Pinterest Worksheet`)
- realtime job monitoring and websocket feedback
- large operational screens with many actions and status states
- custom Threads planner with calendar views and analytics

Important note:

The raw reusable component count is only 10, but that does not mean the UI is simple. In this codebase, much of the complexity lives inside very large page files rather than small composable components.

### State management approach

The frontend uses a mixed approach:

- local component state for most flows
- custom `api.ts` service wrapper for server communication
- Zustand for designer state and history/undo
- context for toast notifications
- browser storage for some worksheet/editor persistence

This works, but it is manual and page-heavy. A future refactor could benefit from a stronger server-state approach for consistency and caching.

### Forms, validations, tables, and charts

Observed UI behavior:

- 12+ major forms across auth, projects, sites, users, settings, and Threads flows
- multiple data-heavy list/table screens
- two spreadsheet/grid-like interfaces
- manual client-side validation in many places
- backend validation through Pydantic/FastAPI models
- lightweight custom analytics visuals in Threads
- no dedicated charting library found

Verdict:

- Forms: Strong presence
- Validations: Moderate
- Tables/grids: Strong presence
- Charts/BI: Light to moderate, not a major analytics product yet

## 5. Database Analysis

### Database technology

- PostgreSQL
- SQLAlchemy async ORM
- Alembic migrations

### Table count

The schema currently contains 20 tables:

- `audit_logs`
- `users`
- `password_setup_tokens`
- `prompts`
- `user_credentials`
- `spy_sheets`
- `projects`
- `project_members`
- `project_credentials`
- `sites`
- `recipes`
- `jobs`
- `job_logs`
- `project_publish_schedules`
- `pin_designer_templates`
- `threads_projects`
- `threads_accounts`
- `threads_posts`
- `system_cleanup_state`
- `cleanup_config`

### Relationship complexity

Relationship complexity: Complex relational model

Evidence:

- 25 foreign keys
- 22 ORM relationships
- join table for project membership
- owner-level isolation and project-level permissions
- many one-to-many relations across projects, sites, recipes, jobs, logs, accounts, and posts

This is not an overcomplicated enterprise schema, but it is clearly beyond simple CRUD.

### Migrations and data handling

Migration maturity:

- 32 Alembic migration files are present
- the schema evolved repeatedly with real feature growth

Important technical note:

- the app still calls `Base.metadata.create_all()` during startup
- the backend Docker startup also runs `alembic upgrade head`

This mixed strategy is acceptable during early growth, but in a mature production setup it can create confusion and schema drift risk. The project should standardize on Alembic-driven migrations only.

## 6. Feature Breakdown

| Feature | Description | Complexity | Estimated Dev Time (days) |
|---|---|---|---:|
| Platform foundation and deployment | Repo setup, Docker, env config, database bootstrapping, backend/frontend deployment preparation | Medium | 6-8 |
| Authentication and account lifecycle | Login, register, Google OAuth, invite/setup password, forgot/reset password, cookie auth | High | 8-10 |
| Workspace and access management | Owners, admins, members, project membership, project CRUD, user management | High | 8-10 |
| Site and recipe workspace | Site CRUD, recipe CRUD, image upload, detailed recipe management UI | High | 8-10 |
| AI generation engine | OpenAI prompts, article generation, recipe JSON, metadata, category, pin metadata | High | 12-15 |
| Background jobs and realtime logs | Job creation, stop/resume, progress tracking, websocket logs, reconciliation logic | High | 10-12 |
| WordPress publishing and scheduling | Publish article, batch publish, scheduling, backdating, SEO metadata, cleanup retention | High | 12-14 |
| Pinterest workflows | Boards, pin creation, gallery usage, pin metadata, template-linked publishing | Medium-High | 6-8 |
| Pin Designer runtime editor | Per-recipe visual editor, layers, assets, text tools, image zones, undo/history | Very High | 18-22 |
| Template designer and template library | Template editor, import/export, project assignment, reusable layouts | Very High | 12-15 |
| Multi-site generation workflow | One recipe input reused across all sites, shared image logic, multi-site generation history | High | 12-15 |
| Threads publishing module | Project/accounts/posts, media upload, planner, analytics, scheduling, batch publish | High | 12-15 |
| Spreadsheet and export workflows | Spy Sheet, Pinterest Worksheet, Excel import/export, project/site export | Medium-High | 8-10 |
| Security, audit, cleanup, QA, stabilization | Audit logs, headers, rate limiting, retention automation, regression fixing, release hardening | High | 10-12 |

Estimated total from feature breakdown:

- 138-171 working days

## 7. Development Effort Estimation

### Total estimated development time

Realistic solo senior freelancer estimate:

- 138-171 working days
- roughly 7.0-8.5 calendar months at 20 working days/month

This assumes:

- one senior full-stack freelancer
- normal client feedback loops
- full delivery from build to stabilization
- no dedicated separate QA engineer or UI designer

### Frontend / backend split

Estimated effort split:

| Area | Estimated Days | Share |
|---|---:|---:|
| Backend | 74-93 | ~54% |
| Frontend | 64-78 | ~46% |

Why backend is slightly higher:

- 112 endpoints
- 20-table schema
- multiple third-party integrations
- job orchestration and scheduler logic
- publishing and automation complexity

Why frontend remains very heavy:

- advanced Pin Designer
- large site operations screen
- spreadsheet UI
- Threads planner and analytics

## 8. Complexity Score

Global complexity score: Very High

### Why this project scores Very High

- It combines content operations, social publishing, and media tooling in one product.
- It has 112 REST endpoints and 20 DB tables, which is already significant scope.
- It depends on many third-party services, increasing failure modes and support load.
- It includes a custom visual editor and spreadsheet-like UIs, which are expensive features.
- It includes background jobs, schedulers, retention rules, and realtime logs.
- It supports multiple users, roles, projects, and sites.

If this project only had auth + project management + recipe CRUD, the score would be High.

The custom designer, multi-channel publishing, and automation layers are what push it into Very High territory.

## 9. Code Quality

### Overall assessment

Code quality is above average at product-foundation level, but with visible maintainability debt.

Short verdict:

- Structure quality: Good foundation, moderate internal sprawl
- Naming conventions: Mostly clear
- Best practices usage: Mixed but generally decent

### Positive quality signals

- backend/frontend separation is clear
- backend service modules exist instead of everything living in controllers
- auth uses HTTP-only cookies instead of storing JWTs in browser local storage
- security headers and rate limiting are present
- audit logs exist
- frontend production build passes
- backend automated tests present and passing
- Docker-based deployment path exists

### Quality concerns

- very large files reduce readability and raise regression risk
- frontend state and data fetching are manually orchestrated in many pages
- linting is not properly configured yet
- automated tests are narrow compared with system size
- in-memory job tracking is a scaling and reliability constraint
- schema creation strategy is mixed (`create_all` plus Alembic)

### Best-practice maturity

What is already good:

- cookie-based auth
- role checks
- async DB access
- migration history
- websocket progress streaming
- deployment containerization

What is still missing for stronger enterprise-grade quality:

- broader API integration tests
- frontend component/E2E tests
- distributed job queue
- central observability/metrics
- deeper modularization of the largest files

## 10. Market Price Estimation

### Pricing assumptions

These prices assume:

- a real client delivery, not an internal side project
- one senior full-stack freelancer pricing the full product fairly
- fixed-price or milestone-based delivery with usual freelance risk
- third-party subscription costs excluded
- hosting, OpenAI, Cloudinary, email, Meta/Threads, Pinterest, and WordPress operational costs excluded

### Recommended price ranges

| Market | Minimum | Average | Premium |
|---|---:|---:|---:|
| Morocco freelance market | 180,000 MAD | 260,000 MAD | 380,000 MAD |
| International freelance market | 24,000 USD | 36,000 USD | 52,000 USD |

### How to interpret the pricing bands

Minimum:

- client has a clear scope
- few revisions
- single decision-maker
- limited post-launch support
- freelancer prices aggressively to win the deal

Average:

- this is the fairest quote for a normal real-world client
- includes integration risk, iteration, hardening, and reasonable support

Premium:

- stronger discovery phase
- tighter deadlines
- higher accountability
- better documentation and post-launch support
- more senior positioning and stronger delivery discipline

## 11. Pricing Justification

### Why the project deserves this pricing

#### 1. Complexity

This is not just a dashboard. It includes:

- AI content generation
- publishing automation
- social publishing
- image workflows
- custom visual editing
- realtime operations
- spreadsheet-like research tooling

Any one of these areas can already form a substantial standalone feature set.

#### 2. Time

At roughly 138-171 working days, this is a long-form product build, not a short sprint.

Underpricing such a project usually leads to:

- rushed integrations
- weak testing
- unfinished edge cases
- poor post-launch support

#### 3. Business value

The business value is high because the platform can:

- reduce manual article creation time
- centralize multi-site content operations
- improve publishing consistency
- make Pinterest and Threads output operational instead of ad hoc
- let a small team handle higher content volume

This creates direct operational leverage for the client.

### Why Morocco pricing is lower than international pricing

Morocco pricing is lower because local freelance markets are typically priced below Western remote markets.

However, this project should still not be sold cheaply in Morocco because:

- the scope is closer to a small SaaS
- the integration risk is high
- the maintenance burden is real
- the UI/editor work is custom, not template-based

### Why the premium band is justified

The premium band becomes justified when the freelancer also provides:

- clearer discovery and specification work
- stronger QA ownership
- architecture responsibility
- deployment support
- short-term post-launch warranty/support

## 12. Benchmark Anchors Used For Pricing

Pricing was anchored against current market references and then adjusted to this project's actual scope.

Local Morocco benchmarks:

- Claro Digital hiring guide (published Mar 12, 2026): freelancer rates around 200-600 MAD/hour and senior Morocco salary benchmarks of 25,000-45,000 MAD/month for senior developers  
  Source: [clarodigi.com/blog/hire-developers-morocco-complete-guide](https://clarodigi.com/blog/hire-developers-morocco-complete-guide/)
- Glassdoor Morocco software developer pay (last updated Mar 29, 2026): around 8K-15K MAD/month, median 11K MAD/month  
  Source: [glassdoor.com/Salaries/morocco-software-developer-salary-SRCH_IL.0%2C7_IN162_KO8%2C26.htm](https://www.glassdoor.com/Salaries/morocco-software-developer-salary-SRCH_IL.0%2C7_IN162_KO8%2C26.htm)
- Levels.fyi Morocco software engineer compensation (last updated Apr 23, 2026): median total comp about 157K MAD/year  
  Source: [levels.fyi/t/software-engineer/locations/morocco](https://www.levels.fyi/t/software-engineer/locations/morocco)
- Claro Digital software development cost guide: complete SaaS projects in Morocco estimated around 350,000-800,000 MAD  
  Source: [clarodigi.com/blog/custom-software-development-morocco](https://clarodigi.com/blog/custom-software-development-morocco/)

International freelance benchmarks:

- Upwork full-stack developers: 16-35 USD/hour  
  Source: [upwork.com/hire/full-stack-developers/cost](https://www.upwork.com/hire/full-stack-developers/cost/)
- Upwork React developers: 51-75 USD/hour  
  Source: [research.upwork.com/hire/react-developers/cost](https://research.upwork.com/hire/react-developers/cost/)
- Arc full-stack freelancers: average 61-80 USD/hour  
  Source: [arc.dev/freelance-developer-rates/full-stack](https://arc.dev/freelance-developer-rates/full-stack)

Exchange-rate reference:

- XE USD/MAD converter, opened Apr 23, 2026; snippet indicated about 1 USD = 9.38 MAD on Apr 6, 2026  
  Source: [xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=MAD](https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=MAD)

Important note:

- I did not blindly convert one market into the other.
- Morocco pricing and international pricing were estimated separately, then cross-checked against the exchange rate.

## 13. Recommendations

### Technical recommendations

- Break down the largest backend route files into smaller application services/use-cases.
- Split the largest frontend pages into smaller components and reusable hooks.
- Move job execution and scheduling to a distributed queue model if horizontal scaling is planned.
- Standardize schema management on Alembic only for production.
- Add proper ESLint configuration and CI lint checks.
- Add API integration tests and at least a small E2E smoke suite for critical flows.

### Product recommendations

- Add onboarding/setup wizards to reduce operator friction.
- Add better operational analytics and publishing performance dashboards.
- Add failure reporting and retry management for external integrations.
- Add approval workflows if multiple team members publish content.
- Add billing/plan/usage controls if the product is intended to become a sellable SaaS.

### Recommendations to increase pricing potential

- Position it as a niche vertical SaaS for recipe publishers or content agencies.
- Package the Pin Designer and multi-site automation as premium differentiators.
- Improve reliability around jobs and schedulers before pitching to larger clients.
- Add polished onboarding, documentation, and admin reporting for stronger commercial value.
- Offer a support and maintenance retainer after delivery.

## Final Conclusion

This project is commercially valuable and technically substantial.

It should be valued as:

- a specialized content automation platform
- a workflow-heavy B2B admin product
- an integration-rich system with real maintenance cost

It should not be priced like a small website, a simple dashboard, or a lightweight CRUD app.

If quoted today as a real freelance delivery, my recommended fair pricing is:

- Morocco: around 260,000 MAD average, with 180,000 MAD as a floor and 380,000 MAD as a strong premium quote
- International: around 36,000 USD average, with 24,000 USD as a floor and 52,000 USD as a strong premium quote

That pricing is justified by the product scope, not just the code volume.
