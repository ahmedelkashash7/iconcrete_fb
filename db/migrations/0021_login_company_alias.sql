-- Login may receive a company label that differs from the stored legal/demo name by
-- common qualifiers ("IConcrete التجربة" vs "IConcrete Demo Company"). Keep the
-- exact id/name/tax-id match first and fall back to a normalized comparison.

create or replace function auth_company_key(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
           translate(
             regexp_replace(
               lower(btrim(coalesce(p_name, ''))),
               '(شركة|company|demo|التجريبية|التجربة|trial|test)',
               '',
               'g'
             ),
             'أإآىة',
             'ااايه'
           ),
           '[[:space:][:punct:]]',
           '',
           'g'
         )
$$;

revoke all on function auth_company_key(text) from public;
grant execute on function auth_company_key(text) to iconcrete_app;

create or replace function auth_find_company(p_name text)
returns table (id text, name_ar text, name_en text, tax_id text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name_ar, c.name_en, c.tax_id
    from companies c
   where c.deleted_at is null
     and (
       lower(btrim(p_name)) in (lower(c.name_ar), lower(c.name_en), lower(c.tax_id), lower(c.id))
       or (
         auth_company_key(p_name) <> ''
         and auth_company_key(c.name_ar) = auth_company_key(p_name)
       )
       or (
         auth_company_key(p_name) <> ''
         and auth_company_key(c.name_en) = auth_company_key(p_name)
       )
     )
   order by (lower(btrim(p_name)) in (lower(c.name_ar), lower(c.name_en), lower(c.tax_id), lower(c.id))) desc
   limit 1
$$;

revoke all on function auth_find_company(text) from public;
grant execute on function auth_find_company(text) to iconcrete_app;
