# Rank Math metadata bridge

The app can generate SEO content without this plugin. Verified Rank Math REST
saving requires the three metadata fields to be registered on the WordPress site.

Upload the packaged `recipebot-seo-meta.zip` through WordPress Plugins > Add New >
Upload Plugin, then activate it. Alternatively install `recipebot-seo-meta.php`
as a normal WordPress plugin. Activate it on
each Rank Math site if another integration does not already expose these fields.
The plugin does nothing when Rank Math is inactive. It registers only the title,
description, and focus keyword, and requires the authenticated user to have
permission to edit the target post. Use the site's existing WordPress application
password credentials.

The app checks the values with an authenticated read after writing. Missing REST
fields produce an "unverified" warning; different values produce a failure.
An SEO warning does not retry article creation or fabricate a Rank Math score.

For an existing article, open its SEO tab, choose Edit SEO, save a keyword/title/
description, and choose Sync SEO to WordPress. This edits metadata on the saved
post ID; it does not create another article or change the existing URL. It does not
rewrite the article to add missing keyword occurrences. Review the article too.

Custom saved project prompts are retained. Generation supplies `focus_keyword`
to article, title, and description templates and appends consistency constraints.
Built-in prompts apply only where there is no saved override. The Settings view
includes inherited owner prompts, following the worker's precedence.

Generated articles target 750–1000 useful body words. Checks flag fewer than 600
body words, missing keyword placement in the H1, first paragraph or a relevant
H2/H3, and title/description keyword or length issues. One best-effort repair is
attempted. Remaining SEO issues become warnings in the job logs; generation
continues with usable content even if the repair fails. Empty or failed initial
AI responses and incomplete recipe cards still fail generation. These are
editorial checks, not guarantees of search rankings or Pinterest Rich Pin display.

The bridge has not been installed on a live site by this task. Test authenticated
REST access after deploying it. Rank Math's editor may need to recalculate its
own analysis; this plugin never writes an artificial score.

Local verification covered 33 SEO/API regression tests, six publisher image/embed
tests, five publishing configuration checks, Python compilation and TypeScript
type checking. External calls were mocked. PHP/WordPress was unavailable locally,
so the bridge still needs runtime verification on WordPress before production use.
