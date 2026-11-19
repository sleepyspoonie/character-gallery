# Character Gallery

A gallery of character art, picrews and dollmakers, grouped by character. It runs entirely on
GitHub Pages: the pictures live in `images/` and everything about them lives in `data/gallery.json`.
Anyone with the link can look; only someone signed in with a GitHub key can upload or change things.

## One-time setup (about 10 minutes)

### 1. Make the repository
1. On GitHub, click **+** (top right) → **New repository**.
2. Name it `character-gallery` (or anything you like).
3. Set it to **Public**. (GitHub Pages on a free account needs a public repo, so anyone who finds
   the link or the repo can see the pictures. A paid GitHub plan lets you keep it private.)
4. Click **Create repository**.

### 2. Put these files in it
1. On the new repo's page, click **uploading an existing file**.
2. Drag in everything from this folder: `index.html`, `app.js`, `styles.css`, `README.md`,
   and the `images` and `data` folders.
3. Click **Commit changes**.

### 3. Turn on GitHub Pages
1. In the repo, go to **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, then pick
   **main** and **/(root)** and click **Save**.
3. After a minute or two the page shows your site's address, something like
   `https://YOUR-USERNAME.github.io/character-gallery/`. Bookmark it.

### 4. Make a key so the site can save your uploads
1. On GitHub, click your profile picture → **Settings** → **Developer settings** (bottom of the left
   menu) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name it something like "Character Gallery", and pick an expiration date.
3. Under **Repository access**, choose **Only select repositories** and pick your gallery repo.
4. Under **Permissions** → **Repository permissions**, set **Contents** to **Read and write**.
5. Click **Generate token** and copy it (it starts with `github_pat_`). GitHub only shows it once.

### 5. Sign in on the site
Open your gallery, click **Sign in**, and paste the key. Your username and repo name are filled in
automatically. Do this once on each device you upload from. The key is stored only in that browser.
It never goes into the repository.

When the key expires, make a new one the same way and sign in again from the gear icon.

## Using it

- **Upload picture** (top right): choose, drop or paste an image, then add characters, tags,
  where it's from, a link, who made it and notes. Typing a character name that doesn't exist yet
  creates a new spot in the gallery. If you're on a character's page, that character is filled in for you.
- **Files are renamed** on upload to `character-name-YYYYMMDD-xxxxxx.png`, so two files called
  `image.png` never clash. The original file name is kept in the picture's details.
- **Gallery picture:** each character's tile shows their newest picture unless you open a picture's
  **Details** and tick **Use as … gallery picture**. That choice sticks even when you add newer
  pictures. Untick it to go back to "newest".
- **Edit details** and **Delete** are in each picture's Details panel when you're signed in.
- **Character tiers:** on a character's page, set them to **Major**, **Minor** or **Background**.
  The tier belongs to the character, not to any one picture.
- **Homepage order:** by default the homepage groups characters by tier (major → minor → background),
  newest first within each group, and characters with no tier go at the bottom. The buttons on the homepage
  switch to **Most recent**, **Least recent** or **A–Z** for that visit. To change the default for everyone,
  open **Settings** (the gear icon) → **Homepage**.
- **Show filter:** the row of tick-boxes on the homepage (Major, Minor, Background, No tier) hides or shows
  each tier for that visit. To keep background characters out of sight unless someone asks for them, tick
  **Hide background characters by default** in **Settings** → **Homepage**.
- Changes show up straight away for you. The public copy of the site takes about a minute to catch up
  while GitHub republishes it.

## Picrew button (Firefox or any desktop browser)

1. Sign in on the gallery, open **Settings** (gear icon) and find **Picrew button**.
2. Drag **Send to Character Gallery** onto your bookmarks toolbar. (No toolbar in Firefox? Press
   Ctrl+Shift+B, or ⌘⇧B on a Mac.)
3. Make a picture in a Picrew and finish it. On the page that shows your finished picture
   (its address ends in `/complete?cd=…`), click the bookmark.
4. A small gallery window opens with the picture, the Picrew's name and its link filled in. If you've
   used that Picrew before, it reuses the name you gave it. Add characters and tags, then
   **Add to gallery**. The window closes itself when it's saved.

If Picrew ever refuses to hand the picture over directly, the window says so and shows a faded copy.
Right-click the picture on the Picrew tab, choose **Copy Image**, come back and press Ctrl+V (⌘V).

If your browser blocks the window, allow pop-ups for picrew.me.

## How it works (if you're curious)

Each upload, edit, feature or delete is a single commit to the repo made through the GitHub API, so the
repo's history is a full log of every change and anything can be rolled back there. `data/gallery.json`
can also be edited by hand on GitHub if you ever need to fix something in bulk.
