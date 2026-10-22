# Source Image Articles

Open **Source Image Articles** in the sidebar (`/source-articles`). It is reserved
for `khalil@gmail.com` and still requires membership of the selected project.
The old `/cloudflare` address redirects to this page.

1. Choose an existing project containing at least one website.
2. Upload your input image or enter its public HTTP(S) URL, together with the recipe
   text. The existing Excel/CSV import format is unchanged.
3. Click **Run All Sites Job**. The server prepares **one image per input**:
   it zooms into the center by **10%**, resizes back to the original dimensions,
   then **mirrors horizontally**. The original file stays untouched.
4. The prepared JPEG is saved locally and reused across all sites for that input.
   Review it in the article history's Images tab. Article text, recipe JSON, SEO,
   Pinterest metadata, export and WordPress publishing use the existing workflow.

This is deterministic image processing with Pillow. No Cloudflare or Midjourney
requests, image-generation token, model or credits are involved. OpenAI is still
used for the article text with the existing project credentials and prompts.

Image URLs must be reachable by the server; local uploads are read directly from
`UPLOADS_DIR` (default `/app/uploads`). Images are limited to 25 MB. A missing or
invalid source image fails that input before articles are written. Correct the
source or upload a valid image, then retry. The saved copy is cached so a resume
does not repeatedly edit the already edited result.

New jobs store `image_provider=source_image`. Older Cloudflare jobs, when resumed,
also use the input-image edit instead of making Cloudflare requests. Their saved
history remains visible. Finished articles are not rewritten automatically.
Cloudflare configuration/test endpoints are retired and return HTTP 410.

For installations predating the image-provider feature, run `alembic upgrade head`
from `backend/`, then restart the backend and frontend. The existing migration
already supports the new provider; no further migration is needed. Keep uploads
on persistent storage and configure `SERVER_BASE_URL` for reachable article images.
