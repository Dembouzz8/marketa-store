begin;

create or replace view public.public_active_vendors
with (security_barrier = true)
as
select
  v.id,
  v.name
from public.vendors as v
where v.is_active = true;

comment on view public.public_active_vendors is
  'Public storefront projection exposing only IDs and names of active vendors.';

revoke all
on table public.public_active_vendors
from public;

revoke all
on table public.public_active_vendors
from anon, authenticated;

grant select
on table public.public_active_vendors
to anon, authenticated;

commit;