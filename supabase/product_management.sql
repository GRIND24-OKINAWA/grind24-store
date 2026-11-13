-- Run AFTER schema.sql. Product prices/costs are server-owned.
create table if not exists products (
 id text primary key, name text not null, description text not null default '',
 price integer not null check(price>=0), cost integer not null default 0 check(cost>=0),
 emoji text not null default '📦', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into products(id,name,description,price,cost,emoji) values
 ('pure-sport','PURE SPORT','爽やかなスポーツ系',1980,0,'🔵'),
 ('fiji','FIJI','南国を感じる香り',2200,1100,'🌴'),
 ('captain','CAPTAIN','大人っぽい爽やかさ',1980,0,'⚓')
on conflict(id) do update set price=excluded.price,cost=excluded.cost where products.id='fiji';
insert into inventory(product_id,stock) select id,0 from products on conflict do nothing;
alter table products enable row level security;
-- Public cannot read cost; public product listing is served by a server endpoint.
-- Only service role accesses tables.
create or replace function set_product_stock(p_id text,p_stock integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_stock<0 then raise exception 'invalid stock';end if;
 insert into inventory(product_id,stock) values(p_id,p_stock)
 on conflict(product_id) do update set stock=excluded.stock;
end $$;
revoke execute on function set_product_stock(text,integer) from public,anon,authenticated;

-- Make paid webhook idempotent for repeated Stripe delivery.
create or replace function mark_order_paid(p_order_id uuid,p_email text,p_name text,p_phone text,p_address text,p_session_id text) returns void language plpgsql security definer set search_path=public as $$
declare v_order orders%rowtype;
begin
 select * into v_order from orders where id=p_order_id for update;
 if not found then raise exception 'unknown order';end if;
 if v_order.status in ('paid','shipped','collected') and v_order.stripe_session_id=p_session_id then return;end if;
 if v_order.status<>'reserved' then raise exception 'order not reserved; investigate payment';end if;
 update orders set status='paid',email=p_email,name=p_name,phone=p_phone,address=p_address,stripe_session_id=p_session_id where id=p_order_id;
end $$;
revoke execute on function mark_order_paid(uuid,text,text,text,text,text) from public,anon,authenticated;
