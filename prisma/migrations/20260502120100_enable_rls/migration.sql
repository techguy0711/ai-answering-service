-- Row-level security.
--
-- Pattern: every per-tenant table has RLS enabled with a policy that requires
-- `app.current_tenant` to match the row's tenant_id. The helper at
-- src/lib/db.ts (`withTenant`) sets this GUC inside a transaction.
--
-- IMPORTANT — production deployment:
--   RLS only applies to non-superuser, non-table-owner roles.
--   In local dev the app connects as the `postgres` superuser, which BYPASSES
--   RLS. That's fine for getting started, but means the safety net does not
--   actually fire in dev.
--   For production (Railway etc.) you MUST configure the app's DATABASE_URL
--   to use a limited role:
--
--     CREATE ROLE app_user LOGIN PASSWORD '<strong-pw>';
--     GRANT CONNECT ON DATABASE ai_answering TO app_user;
--     GRANT USAGE ON SCHEMA public TO app_user;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--
--   Then point your runtime DATABASE_URL at app_user. Migrations and seed
--   should still run as a privileged role.
--
-- Notes:
--   - The `tenants` table itself does NOT have RLS — auth needs to look up
--     tenants without already having tenant context.
--   - The `users` table has RLS by tenant_id. Auth (which needs to look up
--     a user by email before knowing their tenant) goes through the
--     superuser/admin path — see src/lib/db.ts `dbAdmin`. In production this
--     means auth runs through a separate connection or accepts the cost of
--     temporarily switching roles.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'phone_numbers',
    'services',
    'google_calendar_connections',
    'appointments',
    'call_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id::text = current_setting('app.current_tenant', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    $f$, t);
  END LOOP;
END $$;
