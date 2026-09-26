# jat4/admin

Admin Log In and inbox frontend for the shared Supabase project \`jat4's Project\`.

## Admin setup
1. Create the admin user in Supabase Authentication with an email and password.
2. After the user exists, add its Auth user UUID to \`public.admin_users\`:
   \`insert into public.admin_users (user_id, display_name) values ('AUTH_USER_UUID', 'Admin');\`
3. Open this app and use that email/password on **Admin Log In**.

Only users present in \`admin_users\` can read applications or send admin replies. RLS protects the tables.

Supabase project ref: \`dxmyyymeyypxcjtmelvj\`.