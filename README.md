# Meal Plan — Canadian Offline PWA & Weekly Flyer Pipeline

**Meal Plan** is an automated, mobile-first Progressive Web App (PWA) tailored for **Samsung Galaxy S25** (`390px–430px` viewports, Chrome "Add to Home Screen" installable, and **PWABuilder** Android APK/TWA ready) paired with a weekly Python + GitHub Actions grocery flyer pipeline for Canadian postal codes (default `H1W`).

## Overview

- **Weekly Store Selection (Canadian Postal Code, Maxi vs. Super C)**: Every Thursday, `scripts/update_plan.py` queries the Flipp backend API (`locale=en-ca`, normalizing any 3-char FSA or 6-char Canadian postal code), compares **Maxi** and **Super C** across a weighted grocery basket (**65% core lean proteins**: pork shoulder/loin, chicken thighs/breasts, canned tuna/sardines, eggs; **35% staple carbs & produce**: potatoes, rice, cabbage, cucumbers, tomatoes, carrots, white beans), selects **one** winning store for the week, assigns **Price Radar** tags (`HISTORIC LOW`, `HOT DEAL`, `FLYER DEAL`, `REGULAR`), and writes identical `public/data.json` and `./data.json`.
- **Customizable User Profile & Postal Code**: In the **Settings / Targets** tab, users can customize their **Profile Description** and **Canadian Postal Code** (saved privately in local device storage). You can also set a repository variable `POSTAL_CODE` (or pass `postal_code` in manual `workflow_dispatch`) for the automated GitHub Actions pipeline.
- **Zero Added Cooking Oil & Deterministic Macro Scaling**: All meal templates enforce a strict zero-added-cooking-oil rule (dry-sear, air-fry, or braise in natural rendered juices, broth, or water). Client-side `js/macroEngine.js` (`solveDailyPortions`, `scaleToHorizon`) uses verified raw-basis per-100g nutrition data across:
  - **Goal Presets**: *Aggressive Cut* (`1,900 kcal / 200g P / 50g F / 160g C`), *Body Recomp* (`2,400 kcal / 175g P / 80g F / 245g C`), *Maintenance* (`2,800 kcal / 190g P / 85g F / 315g C`), plus live custom sliders with a strict fat-ceiling guard.
  - **Prep Horizon & Storage Splits**: `3 Days`, `7 Days`, `14 Days`, or Custom Days with automatic **Fridge (Days 1–4)** vs. **Freezer (Day 5+)** batch splits, 24-hour **"When to Thaw"** alerts, aisle-ordered grocery lists (`Produce → Meat → Dairy/Eggs → Pantry/Canned → Frozen`), **"Have at Home"** deductions, and 0%-tax CAD checkout totals.
- **Offline-First 4-Tab Mobile UI**: `Meals`, `Prep` (parallel Build-System cooking timeline + embedded timers), `Groceries`, and `Settings / Targets`, backed by `localStorage` persistence and a Stale-While-Revalidate Service Worker (`sw.js`).

### Project Layout

```text
.
├── .github/workflows/weekly_flyer_sync.yml
├── scripts/
│   ├── update_plan.py
│   └── requirements.txt
├── icons/
│   ├── icon-192.svg
│   ├── icon-512.svg
│   ├── icon-192.png
│   └── icon-512.png
├── js/
│   ├── macroEngine.js
│   └── app.js
├── public/
│   └── data.json
├── tests/
│   ├── test_update_plan.py
│   └── macroEngine.test.js
├── data.json
├── index.html
├── manifest.json
├── sw.js
└── README.md
```

---

## 1. Local Development & Testing

### Prerequisites

- **Python 3.12+**
- **Node.js 20+** *(built-in `node --test` runner; no `npm install` required for unit tests)*
- *Windows PowerShell note*: If `.ps1` wrappers (`npm`/`npx`) are blocked by ExecutionPolicy, invoke `npm.cmd` / `npx.cmd`, or call `python` and `node` directly.

### Run the Weekly Pipeline Locally

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/update_plan.py
```

`scripts/update_plan.py` writes identical `public/data.json` and `./data.json`. When `GEMINI_API_KEY` is unset, it still scores Flipp deals (falling back to Montreal `H1W` baseline pricing if offline) and uses deterministic zero-oil meal templates.

### Run Automated Unit Tests

- **Python pipeline tests**:
  ```bash
  python -m unittest discover -s tests -p "test_*.py" -v
  ```
- **JavaScript macro engine tests**:
  ```bash
  node --test tests/macroEngine.test.js
  ```

### Serve the PWA Locally (Why `file://` Fails)

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/` in Chrome or Edge.

> **Important — Do NOT open `index.html` via `file://`**: Browsers require a secure context (`https://` or `http://127.0.0.1` / `http://localhost`) to register `sw.js`, evaluate `manifest.json` for PWA installation, and allow `fetch('./data.json')` without `file://` CORS origin blocks.

---

## 2. GitHub Pages Deployment

1. Push the repository to GitHub with the PWA root files on the `main` branch.
2. Open your repository on GitHub and navigate to **Settings** → **Pages**.
3. Under **Build and deployment → Source**, select **Deploy from a branch**.
4. Under **Branch**, select **`main`** and folder **`/ (root)`**, then click **Save**.
5. Wait 1–2 minutes for the Pages build to finish. Your live PWA will be available at:
   `https://<username>.github.io/<repo>/`

### Why `./` Relative Paths Are Used

GitHub Pages project sites are served from a repository subpath (`/<repo>/`) rather than domain root `/`. Root-anchored paths such as `/data.json` or `/sw.js` would 404 against `https://<username>.github.io/data.json`. Because `index.html`, `manifest.json` (`"id": "./"`, `"start_url": "./"`, `"scope": "./"`), `sw.js`, and `js/app.js` use relative `./` URLs exclusively, the PWA resolves identically on `http://127.0.0.1:8000/` and `https://<username>.github.io/<repo>/`.

---

## 3. `GEMINI_API_KEY` Repository Secret & Deterministic Fallback

To enable weekly Gemini recipe-twist variations in GitHub Actions:

1. Generate an API key in Google AI Studio (`https://aistudio.google.com/apikey`).
2. In your GitHub repository, open **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Set **Name** to **`GEMINI_API_KEY`**.
5. Paste your API key into **Secret** and click **Add secret**.

### Deterministic Fallback Behavior

If `GEMINI_API_KEY` is missing, empty, rate-limited, or returns invalid/oily instructions, `scripts/update_plan.py` never fails the weekly sync. It falls back deterministically to verified zero-oil meal templates (`source: "fallback+flipp"` or `"fallback+baseline"`), while `nutritionDb`, `goalPresets`, `winningStore`, and flyer unit prices remain deterministically computed in Python.

---

## 4. Weekly Flyer Sync Automation (`.github/workflows/weekly_flyer_sync.yml`)

- **Automatic Schedule (`0 13 * * 4`)**: Runs every **Thursday at 8:00 AM EST (`13:00 UTC`)** (9:00 AM EDT during daylight saving time) to match Maxi and Super C weekly flyer rollovers in Montreal. Updated `public/data.json` and `./data.json` are committed and pushed automatically with `[skip ci]`, triggering GitHub Pages to republish.
- **Manual Trigger (`workflow_dispatch`)**:
  1. Open your GitHub repository → **Actions** tab.
  2. Select the **Weekly Flyer Sync** workflow (`.github/workflows/weekly_flyer_sync.yml`) in the left sidebar.
  3. Click **Run workflow**, keep branch **`main`** selected, and click **Run workflow**.
  4. Once the workflow completes and GitHub Pages refreshes (~1 minute), open the PWA's **Settings / Targets** tab and tap **Sync Latest Flyer Data** (which fetches `./data.json?t=<timestamp>` with Network-Only `no-store` and updates the offline cache).

---

## 5. Samsung Galaxy S25 Installation (Chrome "Add to Home Screen")

1. Open **Google Chrome** on your Samsung Galaxy S25 and navigate to `https://<username>.github.io/<repo>/`.
2. Wait a few seconds after initial load so `sw.js` finishes pre-caching the app shell and `./data.json`.
3. Tap Chrome's **⋮** menu in the top-right corner.
4. Tap **Add to home screen** → select **Install** (choose **Install** rather than *Create shortcut* if prompted).
5. Confirm **Install** in the Android prompt.
6. Launch **Meal Plan** from the new icon on your Galaxy S25 home screen or app drawer. It opens full-screen (`display: "standalone"`) with One UI maskable icon framing and works offline inside Maxi or Super C aisles.

---

## 6. PWABuilder Android APK / TWA Packaging

1. Confirm your GitHub Pages deployment (`https://<username>.github.io/<repo>/`) is live over HTTPS.
2. Visit **`https://www.pwabuilder.com`** in a desktop browser.
3. Enter your GitHub Pages URL and click **Start**.
4. Verify that both **Manifest** and **Service Worker** validation checks pass (`name: "Meal Plan"`, `display: "standalone"`, separate `any` and `maskable` `192x192` & `512x512` PNG icons, and active `sw.js` offline fetch handler).
5. Click **Package for stores** → select **Android** (Trusted Web Activity / APK).
6. Configure your Android Package ID (for example, `io.github.<username>.mealplan`), review the generated signing/manifest details, and click **Download Package** to obtain the `.apk`/`.aab` package and `assetlinks.json`.
