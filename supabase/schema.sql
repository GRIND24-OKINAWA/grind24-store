create extension if not exists pgcrypto;
create table if not exists inventory (product_id text primary key, stock integer not null default 0 check(stock>=0));
insert into inventory(product_id,stock) values ('pure-sport',0),('fiji',0),('captain',0) on conflict do nothing;
create table if not exists orders (id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),status text not null default 'reserved' check(status in ('reserved','paid','cancelled','shipped','collected')),delivery text not null check(delivery in ('pickup','shipping')),items jsonb not null,stripe_session_id text unique,email text,name text,phone text,address text,tracking_number text);
create index if not exists orders_created_at_idx on orders(created_at desc);
alter table inventory enable row level security;
alter table orders enable row level security;
-- No public table policies: access only through the server-side service role.
create or replace function reserve_order(p_items jsonb,p_delivery text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_item jsonb;v_stock integer;
begin
 if p_delivery not in ('pickup','shipping') or jsonb_array_length(p_items)<1 then raise exception 'invalid order';end if;
 -- Lock all inventory rows in deterministic order to avoid concurrent overselling.
 perform 1 from inventory where product_id in (select x->>'id' from jsonb_array_elements(p_items) x) order by product_id for update;
 for v_item in select value from jsonb_array_elements(p_items) loop
  select stock into v_stock from inventory where product_id=v_item->>'id';
  if v_stock is null or v_stock < (v_item->>'quantity')::int then raise exception 'insufficient stock';end if;
  update inventory set stock=stock-(v_item->>'quantity')::int where product_id=v_item->>'id';
 end loop;
 insert into orders(delivery,items) values(p_delivery,p_items) returning id into v_id;
 return v_id;
end $$;
create or replace function release_order(p_order_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_order orders%rowtype;v_item jsonb;
begin
 select * into v_order from orders where id=p_order_id for update;
 if not found or v_order.status<>'reserved' then return;end if;
 update orders set status='cancelled' where id=p_order_id;
 for v_item in select value from jsonb_array_elements(v_order.items) loop
  update inventory set stock=stock+(v_item->>'quantity')::int where product_id=v_item->>'id';
 end loop;
end $$;
create or replace function mark_order_paid(p_order_id uuid,p_email text,p_name text,p_phone text,p_address text,p_session_id text) returns void language plpgsql security definer set search_path=public as $$
begin
 update orders set status='paid',email=p_email,name=p_name,phone=p_phone,address=p_address,stripe_session_id=p_session_id where id=p_order_id and status='reserved';
 -- A late payment after stock release requires manual reconciliation, not silent fulfillment.
 if not found then raise exception 'order not in reserved state; investigate payment';end if;
end $$;
revoke execute on function reserve_order(jsonb,text) from public,anon,authenticated;
revoke execute on function release_order(uuid) from public,anon,authenticated;
revoke execute on function mark_order_paid(uuid,text,text,text,text,text) from public,anon,authenticated;
