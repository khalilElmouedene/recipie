# Cloudflare Articles

The **Cloudflare Articles** sidebar entry opens `/cloudflare`. It is available only
to the authenticated account `khalil@gmail.com`. The backend checks the account
for configuration, generation, job access, resume, stop and live logs. Project
membership is still required; the feature does not grant access to other projects.

## Install / update

From `backend/`, run `alembic upgrade head`, then restart the backend and frontend.
Docker applies migrations using its normal startup procedure. The migration adds
`jobs.image_provider` with `midjourney` as the default for existing jobs. No
Cloudflare package, Worker deployment, DNS change or R2 bucket is required.
The backend calls the Workers AI REST API directly.

Keep the existing `ENCRYPTION_KEY` and `SERVER_BASE_URL` configuration. Generated
images are stored in the same uploads directory as the application's public image
files (`UPLOADS_DIR`, default `/app/uploads`). Use persistent storage in production.

## Configure Cloudflare

1. Sign in to your Cloudflare account and open **Workers AI → Use REST API**.
2. Choose **Create a Workers AI API Token** and copy the generated token. A custom
   token needs **Workers AI Read** and **Workers AI Edit**, scoped to your account.
3. Copy the **Account ID** (32 hexadecimal characters).
4. Sign in to this application as `khalil@gmail.com`, open **Cloudflare Articles**,
   enter the Account ID and token, and click **Save settings**.
5. Click **Generate test image**. This makes a real FLUX request and consumes one
   image's worth of Neurons. A saved configuration alone does not verify access.

Credentials are encrypted using the application's existing credential store.
The token is never returned by the Cloudflare configuration endpoint. A blank
token when saving preserves the previous token. These credentials belong to
Khalil's account; they are not inherited from another project owner or member.

Official setup: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

## Generate and publish

1. Choose an existing project that contains at least one website. Its existing
   OpenAI key, text prompts, SEO prompts and website settings are reused.
2. Add recipe inputs manually or import the existing Excel/CSV template. The
   original `image_url` and `recipe_text` input format is retained.
3. Click **Run All Sites Job**. Each recipe input generates **four FLUX images**,
   which are distributed across the project's sites using the existing logic.
   The same article, recipe JSON, SEO, Pinterest metadata and WordPress publishing
   pipeline then runs. OpenAI text generation retains its existing costs.
4. Follow progress in the existing background pipeline and review articles,
   images and SEO in history. Publish immediately, schedule or export using the
   existing controls. Publishing schedules remain shared with the project.

Model: `@cf/black-forest-labs/flux-1-schnell`, four diffusion steps per image.
FLUX Schnell generates from the recipe **text**. The source image is retained in
the recipe record, but this model does not use it as a visual reference. No
Midjourney command flags or Discord requests are sent in Cloudflare jobs.

Cloudflare job history is filtered separately from the regular Midjourney page.
The image provider is saved on each job, including across restarts. Partial image
batches are cached after each successful image; resuming reuses available images
instead of regenerating them. Use **Resume** after an interruption or quota error;
failed Cloudflare recipes are reset for that retry. Starting a new job creates a
new batch and consumes quota again.

## Free allowance and errors

As checked on 2026-10-22, Workers AI includes **10,000 Neurons per day**, shared
across the Cloudflare account. Neurons are the usage unit, not the model name.
Image count within the allowance depends on the model and its settings; the app
does not promise an unlimited number of images or display an estimated remaining
balance. Check the actual balance in the Workers AI dashboard.

On Workers Free, requests fail after the daily allowance is exhausted. On a paid
Workers plan, extra usage may be billed. The application never upgrades your
plan and does not switch to Midjourney when Cloudflare fails. Quota, credential,
timeout and invalid image errors appear in the normal job logs/history.

- Pricing and daily allowance: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Model inputs and output: https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/

## Verification

Offline service/API tests cover authorization, encrypted configuration, job
provider persistence, image caching, partial retry, quota failures, cancellation,
and reuse of the existing text generation pipeline. A live account test still
requires your Account ID and token, via **Generate test image**.
