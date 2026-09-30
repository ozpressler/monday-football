# Shared data setup (Supabase)

Until you do this, the app stores data on each phone only.

## First-time install
1. Create a free account and a new project at https://supabase.com.
2. Open **SQL Editor -> New query**, paste the contents of `supabase.sql`, replace `CHANGE-ME-CREATE-CODE` with a secret "creation code" (anyone creating a new group in the app must type it; use `''` to let anyone create groups), then click **Run**. Do this in the Supabase editor only. Do not commit your real values to GitHub.
3. Copy the **Project URL** and the **anon / publishable key** from Project Settings -> API (never the `service_role` / secret key) into `config.js`.
4. Commit and push.

## Updating an existing install
When a new version adds database features, paste `supabase-update.sql` into the SQL Editor and click **Run**. It is safe to run more than once, and it never touches your groups or data.

## Groups
Each group has its own players, games and stats, a group name, an **admin password** (can edit) and a **viewer password** (can only look).
- Sign in with group name + password. The name is not case sensitive.
- Create a group from the sign-in screen: "Create a new group". It asks for the creation code.
- In the app (Settings) the admin can rename the group, change both passwords, and restore backups.

## Backups
The app saves a copy of the group's data after every finished night and before anything is deleted (delete player, delete all, load demo, import, discard night). The latest 25 are kept. Restore from Settings -> Automatic backups.

## Password attempts
After 10 wrong passwords within 10 minutes, sign-in for that group is blocked for 5 minutes. Wrong attempts count against the group name that was typed, even if it does not exist.

## Useful SQL
Let anyone view a group without a password (they still need the group name):
```sql
update public.app_groups set public_view = true where name = 'group name in lower case';
```
Change the creation code:
```sql
update public.app_config set value = 'new-creation-code' where key = 'create_code';
```
List groups:
```sql
select display_name, name, updated_at from public.app_groups;
```
Clear a lock-out:
```sql
delete from public.app_attempts;
```

## Security notes
- The tables cannot be read directly. Everything goes through database functions that check the passwords.
- Use passwords that are not short or guessable.
