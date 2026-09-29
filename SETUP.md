# Shared data setup (Supabase)

Until you do this, the app stores data on each phone only.

1. Create a free account and a new project at https://supabase.com (any name and region; save the database password somewhere).
2. Open **SQL Editor -> New query**. Paste the contents of `supabase.sql`.
   Before running, replace `CHANGE-ME-VIEW-CODE` (for friends, view only) and `CHANGE-ME-ADMIN-CODE` (for you, can edit) with codes of your own. Then click **Run**.
3. Open **Project Settings -> API** (or "API Keys") and copy:
   - the **Project URL**
   - the **anon / publishable key** (this key is designed to be public; do NOT copy the `service_role` / secret key)
4. Put them in `config.js`:
   ```js
   window.MF_CONFIG = { url: 'https://xxxx.supabase.co', key: 'your-anon-key' };
   ```
5. Commit and push. The site updates in a minute or two.
6. Open the app, enter the admin code on your phone. Data already on that phone is uploaded on the first admin login. Friends enter the viewer code.

## Later: let everyone view without a code
In Supabase SQL Editor run:
```sql
update public.app_state set public_view = true;
```
Viewers then still need to open the app, but are not asked for a code. Editing always needs the admin code.

## Changing codes
```sql
update public.app_state set view_code = 'new-view-code', admin_code = 'new-admin-code';
```
