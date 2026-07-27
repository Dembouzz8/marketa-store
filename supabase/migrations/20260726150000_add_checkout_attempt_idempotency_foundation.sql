alter table public.orders
  add column checkout_attempt_id uuid,
  add column customer_name text;

create unique index orders_checkout_attempt_id_key
  on public.orders (checkout_attempt_id)
  where checkout_attempt_id is not null;

alter table public.orders
  add constraint orders_id_checkout_attempt_id_key
  unique (id, checkout_attempt_id),
  add constraint orders_customer_name_length_check
  check (
    customer_name is null
    or char_length(btrim(customer_name)) between 2 and 100
  );

create table public.checkout_attempts (
  checkout_attempt_id uuid primary key,
  order_id uuid not null unique,
  request_fingerprint text not null,
  payment_reference text,
  payment_authorization_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_attempts_request_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint checkout_attempts_payment_reference_length_check
    check (
      payment_reference is null
      or char_length(payment_reference) between 1 and 100
    ),
  constraint checkout_attempts_payment_authorization_url_check
    check (
      payment_authorization_url is null
      or (
        char_length(payment_authorization_url) <= 2048
        and payment_authorization_url like 'https://%'
      )
    ),
  constraint checkout_attempts_expires_at_check
    check (expires_at is null or expires_at > created_at),
  constraint checkout_attempts_order_checkout_attempt_fkey
    foreign key (order_id, checkout_attempt_id)
    references public.orders (id, checkout_attempt_id)
    on delete cascade
);

comment on table public.checkout_attempts is
  'Service-role-only storage for durable checkout initialization attempts.';

comment on column public.checkout_attempts.payment_authorization_url is
  'Private Paystack bearer payment link; never expose through public data access.';

comment on column public.checkout_attempts.request_fingerprint is
  'Lowercase SHA-256 fingerprint generated server-side after request normalization.';

alter table public.checkout_attempts enable row level security;

revoke all privileges on table public.checkout_attempts
  from public, anon, authenticated;

grant select, insert, update on table public.checkout_attempts
  to service_role;
