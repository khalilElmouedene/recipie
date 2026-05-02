"""
Quick test: can this user hit the WordPress REST API?
Run: python test_wp_auth.py
"""
import requests

# ── Fill these in ─────────────────────────────────────────────
WP_URL  = "https://www.chefbachour.com"   # no trailing slash
USERNAME = "your_username"
PASSWORD  = "your_password"              # try regular password first,
                                          # then an Application Password
# ─────────────────────────────────────────────────────────────

base = WP_URL.rstrip("/") + "/wp-json/wp/v2"
auth = (USERNAME, PASSWORD)

tests = [
    ("GET",  "/users/me",  None,                   "Read own user profile"),
    ("GET",  "/media",     None,                   "List media (read)"),
    ("POST", "/media",     None,                   "Upload media (write) — skipped, just checks auth"),
    ("GET",  "/posts",     None,                   "List posts (read)"),
]

print(f"\nTesting REST API on {WP_URL}\n{'='*55}")

for method, path, body, label in tests:
    url = base + path
    try:
        if method == "GET":
            r = requests.get(url, auth=auth, timeout=10)
        else:
            # For POST /media we just send an empty body to see if auth passes (will get 400, not 403)
            r = requests.post(url, auth=auth, timeout=10,
                              headers={"Content-Disposition": "attachment; filename=test.jpg",
                                       "Content-Type": "image/jpeg"},
                              data=b"")

        if r.status_code == 200:
            status = "OK"
        elif r.status_code == 400:
            status = "OK (auth passed, bad request body — expected for empty upload test)"
        elif r.status_code == 401:
            status = "FAIL — wrong credentials"
        elif r.status_code == 403:
            status = "FAIL — forbidden (Application Password required, or REST API blocked)"
        elif r.status_code == 404:
            status = "FAIL — endpoint not found (REST API disabled?)"
        else:
            status = f"status {r.status_code}"

        print(f"  [{method} {path}]  {status}")
        if r.status_code not in (200, 400):
            try:
                msg = r.json().get("message") or r.text[:120]
            except Exception:
                msg = r.text[:120]
            print(f"    └─ {msg}")

    except requests.exceptions.ConnectionError:
        print(f"  [{method} {path}]  FAIL — cannot reach {WP_URL}")
    except Exception as e:
        print(f"  [{method} {path}]  ERROR — {e}")

print()
print("If all show OK → your credentials work, change wp_password in site config.")
print("If 403 → generate an Application Password in WP admin → Users → Profile.")
print("If 404 → the REST API is disabled on that site (need a plugin or server fix).")
print()
