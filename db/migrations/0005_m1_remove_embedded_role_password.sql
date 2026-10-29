-- Removes the development password literal that earlier versions of 0003 embedded in the
-- role definition. The application role must get its secret from the environment only:
-- set one locally with `ICONCRETE_APP_PASSWORD=... bun run db:role`.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'iconcrete_app') then
    execute 'alter role iconcrete_app password null';
  end if;
end $$;
