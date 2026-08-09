# SQLiteScope website

Static HTML/CSS/JS site for SQLiteScope — a landing page (`index.html`) and a documentation page (`docs.html`). No build step, no dependencies.

```
site/
├── index.html      Landing page
├── docs.html       Documentation
├── assets/
│   ├── style.css
│   ├── main.js
│   ├── icon.svg
│   └── icon.png
└── README.md        (this file)
```

## Preview locally

Any static server works, e.g.:

```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly in a browser also works, since the site has no server-side dependencies.

## Publish with GitHub Pages

The project's `package.json` already points `homepage` at `https://connect2sazad.github.io/sqlitescope`, so Pages should serve from the `sqlitescope` repo.

**Option A — dedicated `gh-pages` branch (recommended for a repo that also holds app source):**

```bash
cd site
git init
git remote add origin https://github.com/connect2sazad/sqlitescope.git
git checkout -b gh-pages
git add .
git commit -m "Add project website"
git push -u origin gh-pages
```

Then in the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `gh-pages` / `root`**.

**Option B — `docs/` folder on `main`:**

Copy this folder's contents into a `docs/` directory at the repo root, commit, then set **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `docs`**.

Either way, the live site will be `https://connect2sazad.github.io/sqlitescope`.

## Editing

- Copy and feature lists are pulled from `README.md`, `SQLITE-CAPABILITIES.md`, `PRIVACY.md`, and `SECURITY.md` in the app repo. If those change, update `index.html` / `docs.html` to match.
- Design tokens (colors, fonts, spacing) live at the top of `assets/style.css`.
- The hero's live theme-switcher is defined in `assets/main.js` (`THEMES` array) — add or edit entries there to match the app's actual installed theme palette.
