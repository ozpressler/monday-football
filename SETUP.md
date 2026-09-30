# Shared data setup (Supabase)

Until you do this, the app stores data on each phone only.

1. Create a free account and a new project at https://supabase.com.
2. Open **SQL Editor -> New query**, paste the contents of `supabase.sql`, and replace:
   - `CHANGE-ME-CREATE-CODE` with a secret "creation code". Anyone creating a new group in the app must type it. Leave it empty (`''`) to let anyone create groups.
   - `CHANGE-ME-GROUP-NAME` with the name of your first group (only used if you are upgrading from the older single-group version; ignored on a fresh install).
   Do this in the Supabase editor only. Do not commit your real values to GitHub.
   Then click **Run**.
3. Copy the **Project URL** and the **anon / publishable key** from Project Settings -> API (never the `service_role` / secret key) into `config.js`.
4. Commit and push.

## Groups
Each group has its own players, games and stats, a group name, an **admin password** (can edit) and a **viewer password** (can only look).
- Sign in with group name + password. The name is not case sensitive.
- Create a group from the sign-in screen: "Create a new group". It asks for the creation code from step 2.

## Useful SQL
Let anyone view a group without a password (they still need the group name):
```sql
update public.app_groups set public_view = true where name = 'group name in lower case';
```
Change a group's passwords:
```sql
update public.app_groups set view_code = 'new-view', admin_code = 'new-admin' where name = 'group name in lower case';
```
Change the creation code:
```sql
update public.app_config set value = 'new-creation-code' where key = 'create_code';
```
List groups:
```sql
select name, updated_at from public.app_groups;
```

## Security notes
- The tables cannot be read directly. Everything goes through three database functions that check the passwords.
- There is no limit on password attempts, so use passwords that are not short or guessable.
