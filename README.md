# Work Order — Task Tracker

A simple site where you (the boss) assign tasks with deadlines to your employees,
each employee logs in with their own account to see and complete their tasks, and
you can download a PDF report of everything at any time.

Total cost: **$0**. Total setup time: **about 15 minutes**, one time only.

---

## Part 1 — Create your free database (Supabase)

This is the "backend" that stores your employees, tasks, and logins.

1. Go to **https://supabase.com** and click **Start your project**. Sign up (free).
2. Click **New project**. Give it any name (e.g. "workorder"), set a database
   password (save it somewhere safe), pick the region closest to you, click **Create new project**.
   Wait ~2 minutes while it sets up.
3. In the left sidebar, click the **SQL Editor** icon.
4. Click **New query**, then open the file **`supabase-schema.sql`** (included in this
   folder), copy all of its contents, paste into the editor, and click **Run**.
   You should see "Success. No rows returned."
5. In the left sidebar, click **Authentication** → **Providers** → click **Email**.
   Turn **OFF** the "Confirm email" toggle, then **Save**.
   (This lets accounts you create work immediately, without email verification —
   important since you're creating employee logins yourself.)
6. In the left sidebar, click **Project Settings** (gear icon) → **API**.
   You'll see:
   - **Project URL** — looks like `https://xxxxxxxx.supabase.co`
   - **anon public key** — a long string of letters/numbers
   Keep this tab open, you'll need both in the next step.

---

## Part 2 — Connect the app to your database

1. Open the file **`config.js`** in this folder with any text editor (Notepad, TextEdit, VS Code).
2. Replace the placeholder values:
   ```js
   const CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",   // paste your Project URL
     SUPABASE_ANON_KEY: "eyJhbGciOi..."                // paste your anon public key
   };
   ```
3. Save the file.

---

## Part 3 — Put it online for free (Netlify)

1. Go to **https://app.netlify.com/drop**
2. Drag the **entire project folder** (this whole folder, containing `index.html`,
   `style.css`, `app.js`, `config.js`) onto the page.
3. Netlify gives you a live web address in seconds, like `https://random-name-123.netlify.app`.
   That's your website — share this link with your employees.
   (Optional: in Netlify you can rename the site or add a custom domain, still free.)

---

## Part 4 — Set yourself up as the boss

1. Open your new website link.
2. Click **"Create the boss account"**, fill in your name, email, and a password.
   This becomes your permanent boss login.
3. You're now on the **Boss Dashboard**.

## Part 5 — Add employees and assign work

1. Under **Employees**, click **+ Add new employee**. Enter their name, email, and
   a temporary password (tell it to them directly — they can change it later using
   the **Change password** button after logging in).
2. Under **Assign a task**, pick the employee, set a deadline, write the task, and click **Assign**.
3. Your employee logs into the same website link with the email/password you gave
   them, and sees their tasks. When done, they click **Mark complete**.
4. Anytime, click **Download PDF report** to get a PDF of every task, who it's
   assigned to, its deadline, and its status.

---

## Updating an already-deployed site (Task History feature)

1. In Supabase → **SQL Editor** → **New query**, paste in **`migration-history.sql`**, click **Run**.
   (Only adds a new table — nothing existing is touched.)
2. Re-upload the updated `index.html`, `style.css`, and `app.js`.

### What's new
Every task now has a **View history** link (on the boss's table, and on each card
in the employee clipboard) showing its full trail — who it was originally assigned
to, and every time it was passed from one employee to another via "Not related to me,"
with names and timestamps.

---

## Updating an already-deployed site (Team Clipboard feature)

If you already set this up before and are just updating the files:

1. In Supabase, go to **SQL Editor** → **New query**, paste in the contents of
   **`migration-clipboard.sql`**, and click **Run**. (This only updates permissions —
   your existing employees and tasks are untouched.)
2. Re-upload the updated `index.html`, `style.css`, and `app.js` to wherever you're
   hosting (GitHub Pages / Netlify) — `config.js` does not need to change.

### What's new
Employees now see a shared **Team Clipboard** listing every task given to the
whole team, not just their own — so everyone has visibility into what's going on.
- Tasks assigned to *them* are fully interactive: **Mark complete**, or
  **Not related to me** (instantly hands the task to a teammate you pick from a list).
- Tasks assigned to *others* show up faded, for visibility only — they can't be edited.

---

## Notes

- This is a genuinely multi-user site — you and each employee log in separately,
  from any device (phone, laptop), and everyone sees live, shared data.
- Free tier limits: Supabase's free plan supports up to 50,000 monthly active
  users and pauses a project only after **7 days of total inactivity** (opening
  the site resets that clock) — more than enough for a small team.
- If something looks broken, the most common cause is `config.js` not being
  filled in correctly, or step 5 in Part 1 (disabling email confirmation) being skipped.
