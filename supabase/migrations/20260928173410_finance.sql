-- Saldo: user-isolated ledger. Money never enters the browser as floating-point JSON.
create schema if not exists finance;
revoke all on schema finance from public, anon, authenticated;

create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(display_name) between 1 and 80),
 cutoff date not null, onboarded boolean not null default false,
 quote_settings jsonb not null default '{"banks":[],"quantity":"100","min_orders":100,"min_completion":0.95,"min_positive":0.98}',
 version integer not null default 1 check(version>0)
);
create table public.accounts (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80), type text not null check(type in ('bank','cash')),
 bank_method text not null default '', opening_balance numeric(28,2) not null default 0,
 archived boolean not null default false, version integer not null default 1
);
create table public.categories (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80),type text not null check(type in ('expense','income')),
 icon text not null default 'Shapes',color text not null check(color ~ '^#[a-fA-F0-9]{6}$'),
 favorite boolean not null default true,position integer not null check(position>=0),archived boolean not null default false,version integer not null default 1
);
create table public.movements (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('expense','income','transfer','buy','sell','opening','adjustment')),
 account_id uuid references public.accounts(id),destination_id uuid references public.accounts(id),category_id uuid references public.categories(id),
 amount_bob numeric(28,2),usdt_quantity numeric(28,8) not null default 0 check(usdt_quantity>=0),
 fee_bob numeric(28,2) not null default 0 check(fee_bob>=0),fee_usdt numeric(28,8) not null default 0 check(fee_usdt>=0),
 occurred_at timestamptz not null,note text not null default '' check(length(note)<=1000),
 history_only boolean not null default false,voided boolean not null default false,version integer not null default 1,
 recurring_key text, fifo_cost numeric(28,12), unknown_quantity numeric(28,8) not null default 0,realized_profit numeric(28,12)
);
create unique index recurring_once on public.movements(user_id,recurring_key) where recurring_key is not null and not voided;
create table public.account_entries (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 movement_id uuid not null references public.movements(id) on delete cascade,account_id uuid not null references public.accounts(id),amount numeric(28,2) not null
);
create table public.usdt_lots (
 id uuid primary key references public.movements(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 occurred_at timestamptz not null,original_quantity numeric(28,8) not null,remaining numeric(28,8) not null check(remaining>=0),unit_cost numeric(28,12)
);
create table public.usdt_consumptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 movement_id uuid not null references public.movements(id) on delete cascade,lot_id uuid not null references public.usdt_lots(id) on delete cascade,
 quantity numeric(28,8) not null,cost numeric(28,12)
);
create table public.goals (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 80),
 target_amount numeric(28,8) not null check(target_amount>0),target_currency text not null check(target_currency in ('BOB','USDT')),
 reserved_usdt numeric(28,8) not null default 0 check(reserved_usdt>=0),due_date date,archived boolean not null default false,version integer not null default 1,
 check(not archived or reserved_usdt=0)
);
create table public.goal_allocations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,goal_id uuid not null references public.goals(id),
 delta_usdt numeric(28,8) not null,created_at timestamptz not null default now()
);
create table public.budgets (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,category_id uuid not null references public.categories(id),
 month text not null check(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),amount numeric(28,2) not null check(amount>0),version integer not null default 1,
 unique(user_id,category_id,month)
);
create table public.recurring (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 80),
 amount numeric(28,2) not null check(amount>0),category_id uuid not null references public.categories(id),account_id uuid not null references public.accounts(id),
 frequency text not null check(frequency in ('monthly','weekly','yearly')),next_date date not null,anchor_day integer not null check(anchor_day between 1 and 31),
 archived boolean not null default false,version integer not null default 1
);
create table public.quotes (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,price numeric(28,8) not null check(price>0),
 observed_at timestamptz not null,source text not null check(source in ('manual','binance')),sample_count integer not null check(sample_count between 0 and 20),
 quantity numeric(28,8) not null check(quantity>0),banks jsonb not null default '[]'
);
create table finance.command_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,command_hash text not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,command_hash)
);

-- All reads are protected in the database; writes are available only through the command boundary.
do $$ declare t text; begin
 foreach t in array array['profiles','accounts','categories','movements','account_entries','usdt_lots','usdt_consumptions','goals','goal_allocations','budgets','recurring','quotes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_rows on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if t<>'profiles' then execute format('create index %I on public.%I(user_id)',t||'_owner_idx',t); end if;
 end loop;
end $$;
create index movements_owner_date on public.movements(user_id,occurred_at,id);
create index entries_owner_account on public.account_entries(user_id,account_id);
create index quotes_owner_time on public.quotes(user_id,observed_at desc);

create function finance.assert_owner(u uuid,t text,i uuid,active_only boolean default false) returns void language plpgsql set search_path='' as $$
declare ok boolean;
begin
 if t not in ('accounts','categories') then raise exception 'Referencia inválida';end if;
 execute format('select exists(select 1 from public.%I where id=$1 and user_id=$2 %s)',t,case when active_only then 'and not archived' else '' end) into ok using i,u;
 if not ok then raise exception 'La cuenta o categoría no te pertenece o está archivada.';end if;
end $$;

create function finance.save_entity(u uuid,e text,p jsonb,expected integer default null) returns void language plpgsql set search_path='' as $$
declare i uuid; current_version integer;current_owner uuid;old_balance numeric;old_reserved numeric;qs jsonb;
begin
 if e='profile' then
  select version into current_version from public.profiles where user_id=u;
  if current_version is not null and expected is distinct from current_version then raise exception 'conflicto: los ajustes cambiaron en otro dispositivo.';end if;
  if current_version is not null and (p->>'cutoff')::date<>(select cutoff from public.profiles where user_id=u) then raise exception 'La fecha de corte no se puede cambiar después del inicio.';end if;
  qs=p->'quote_settings';
  if (qs->>'quantity')::numeric<=0 or (qs->>'min_orders')::int<0 or (qs->>'min_completion')::numeric not between 0 and 1 or (qs->>'min_positive')::numeric not between 0 and 1 or jsonb_typeof(qs->'banks')<>'array' then raise exception 'Filtros de cotización inválidos.';end if;
  insert into public.profiles(user_id,display_name,cutoff,onboarded,quote_settings,version) values(u,p->>'display_name',(p->>'cutoff')::date,(p->>'onboarded')::boolean,qs,coalesce(current_version,0)+1)
  on conflict(user_id) do update set display_name=excluded.display_name,quote_settings=excluded.quote_settings,version=excluded.version;
  return;
 end if;
 if e not in ('account','category','goal','budget','recurring','quote') then raise exception 'Configuración inválida.';end if;
 i=(p->>'id')::uuid;
 if e='quote' then
  if exists(select 1 from public.quotes where id=i) then raise exception 'Esta cotización ya existe.';end if;
  insert into public.quotes values(i,u,(p->>'price')::numeric,(p->>'observed_at')::timestamptz,p->>'source',(p->>'sample_count')::int,(p->>'quantity')::numeric,p->'banks');return;
 end if;
 execute format('select user_id,version from public.%I where id=$1',case e when 'account' then 'accounts' when 'category' then 'categories' when 'goal' then 'goals' when 'budget' then 'budgets' else 'recurring' end) into current_owner,current_version using i;
 if current_owner is not null and current_owner<>u then raise exception 'Este registro no te pertenece.';end if;
 if current_version is not null and expected is distinct from current_version then raise exception 'conflicto: el registro cambió en otro dispositivo.';end if;
 if current_version is null and expected is not null then raise exception 'conflicto: el registro ya no existe.';end if;
 if e='account' then
  select opening_balance into old_balance from public.accounts where id=i and user_id=u;
  if old_balance is not null and old_balance<>(p->>'opening_balance')::numeric then raise exception 'Usa un ajuste para conciliar el saldo.';end if;
  if (p->>'opening_balance')::numeric<>round((p->>'opening_balance')::numeric,2) then raise exception 'BOB admite dos decimales.';end if;
  insert into public.accounts values(i,u,p->>'name',p->>'type',coalesce(p->>'bank_method',''),(p->>'opening_balance')::numeric,(p->>'archived')::boolean,coalesce(current_version,0)+1)
  on conflict(id) do update set name=excluded.name,type=excluded.type,bank_method=excluded.bank_method,archived=excluded.archived,version=excluded.version;
 elsif e='category' then
  if exists(select 1 from public.movements where user_id=u and category_id=i) and p->>'type'<>(select type from public.categories where id=i) then raise exception 'No se puede cambiar el tipo de una categoría con historial.';end if;
  insert into public.categories values(i,u,p->>'name',p->>'type',p->>'icon',p->>'color',(p->>'favorite')::boolean,(p->>'position')::int,(p->>'archived')::boolean,coalesce(current_version,0)+1)
  on conflict(id) do update set name=excluded.name,icon=excluded.icon,color=excluded.color,favorite=excluded.favorite,position=excluded.position,archived=excluded.archived,version=excluded.version;
 elsif e='goal' then
  select reserved_usdt into old_reserved from public.goals where id=i and user_id=u;
  insert into public.goals values(i,u,p->>'name',(p->>'target_amount')::numeric,p->>'target_currency',(p->>'reserved_usdt')::numeric,nullif(p->>'due_date','')::date,(p->>'archived')::boolean,coalesce(current_version,0)+1)
  on conflict(id) do update set name=excluded.name,target_amount=excluded.target_amount,target_currency=excluded.target_currency,reserved_usdt=excluded.reserved_usdt,due_date=excluded.due_date,archived=excluded.archived,version=excluded.version;
  if coalesce(old_reserved,0)<>(p->>'reserved_usdt')::numeric then insert into public.goal_allocations(user_id,goal_id,delta_usdt) values(u,i,(p->>'reserved_usdt')::numeric-coalesce(old_reserved,0));end if;
 elsif e='budget' then
  perform finance.assert_owner(u,'categories',(p->>'category_id')::uuid,true);
  if (select type from public.categories where id=(p->>'category_id')::uuid)<>'expense' then raise exception 'El presupuesto necesita una categoría de gasto.';end if;
  if (p->>'amount')::numeric<>round((p->>'amount')::numeric,2) then raise exception 'BOB admite dos decimales.';end if;
  insert into public.budgets values(i,u,(p->>'category_id')::uuid,p->>'month',(p->>'amount')::numeric,coalesce(current_version,0)+1)
  on conflict(id) do update set category_id=excluded.category_id,month=excluded.month,amount=excluded.amount,version=excluded.version;
 elsif e='recurring' then
  perform finance.assert_owner(u,'categories',(p->>'category_id')::uuid,true);perform finance.assert_owner(u,'accounts',(p->>'account_id')::uuid,true);
  if (select type from public.categories where id=(p->>'category_id')::uuid)<>'expense' then raise exception 'El recurrente necesita una categoría de gasto.';end if;
  if (p->>'amount')::numeric<>round((p->>'amount')::numeric,2) then raise exception 'BOB admite dos decimales.';end if;
  insert into public.recurring values(i,u,p->>'name',(p->>'amount')::numeric,(p->>'category_id')::uuid,(p->>'account_id')::uuid,p->>'frequency',(p->>'next_date')::date,(p->>'anchor_day')::int,(p->>'archived')::boolean,coalesce(current_version,0)+1)
  on conflict(id) do update set name=excluded.name,amount=excluded.amount,category_id=excluded.category_id,account_id=excluded.account_id,frequency=excluded.frequency,next_date=excluded.next_date,anchor_day=excluded.anchor_day,archived=excluded.archived,version=excluded.version;
 end if;
end $$;

create function finance.save_movement(u uuid,p jsonb,expected integer default null) returns void language plpgsql set search_path='' as $$
declare old public.movements; i uuid=(p->>'id')::uuid; k text=p->>'kind'; a uuid=(p->>'account_id')::uuid; dest uuid=(p->>'destination_id')::uuid; cat uuid=(p->>'category_id')::uuid;
 amount numeric=(p->>'amount_bob')::numeric;q numeric=(p->>'usdt_quantity')::numeric;fb numeric=(p->>'fee_bob')::numeric;fu numeric=(p->>'fee_usdt')::numeric;
 historical boolean=(p->>'history_only')::boolean;occurred timestamptz=(p->>'occurred_at')::timestamptz;cut date;day date;
begin
 select * into old from public.movements where id=i;
 if old.id is not null and old.user_id<>u then raise exception 'Este movimiento no te pertenece.';end if;
 if old.id is not null and expected is distinct from old.version then raise exception 'conflicto: el movimiento cambió en otro dispositivo.';end if;
 if old.id is null and expected is not null then raise exception 'conflicto: el movimiento ya no existe.';end if;
 if k not in ('expense','income','transfer','buy','sell','opening','adjustment') then raise exception 'Tipo de movimiento inválido.';end if;
 if q is null or fb is null or fu is null or q<0 or fb<0 or fu<0 or q<>round(q,8) or fu<>round(fu,8) or fb<>round(fb,2) then raise exception 'Cantidades o comisiones inválidas.';end if;
 if amount is not null and amount<>round(amount,2) then raise exception 'BOB admite dos decimales.';end if;
 if k<>'opening' then perform finance.assert_owner(u,'accounts',a,old.id is null);if amount is null or(k<>'adjustment' and amount<=0)then raise exception 'El importe debe ser mayor que cero.';end if;end if;
 if k='opening' and(amount<0 or not historical)then raise exception 'La apertura pertenece al historial inicial.';end if;
 if k in ('expense','income') then perform finance.assert_owner(u,'categories',cat,old.id is null);if(select type from public.categories where id=cat)<>k then raise exception 'Categoría incompatible con el movimiento.';end if;elsif cat is not null then raise exception 'Esta operación no utiliza categoría.';end if;
 if k='transfer' then perform finance.assert_owner(u,'accounts',dest,old.id is null);if dest=a then raise exception 'Elige otra cuenta de destino.';end if;elsif dest is not null then raise exception 'Destino inesperado.';end if;
 if k in ('buy','sell','opening') then if q<=0 or(k in ('buy','opening') and q-fu<=0)then raise exception 'Los USDT netos deben ser mayores que cero.';end if;elsif q<>0 or fu<>0 then raise exception 'Esta operación no usa USDT.';end if;
 if k in ('expense','income','adjustment','opening') and fb<>0 then raise exception 'Registra la comisión como gasto separado.';end if;
 if k='sell' and fb>amount then raise exception 'La comisión supera el importe recibido.';end if;
 if historical and k not in ('buy','sell','opening') then raise exception 'Historial inicial inválido.';end if;
 select cutoff into cut from public.profiles where user_id=u;
 if cut is null then raise exception 'Configura tu espacio antes de registrar movimientos.';end if;
 day=(occurred at time zone 'America/La_Paz')::date;
 if historical and day>cut then raise exception 'El historial debe ser anterior a la fecha de corte.';end if;
 if not historical and day<cut then raise exception 'El movimiento es anterior a la fecha de inicio.';end if;
 insert into public.movements(id,user_id,kind,account_id,destination_id,category_id,amount_bob,usdt_quantity,fee_bob,fee_usdt,occurred_at,note,history_only,voided,version,recurring_key)
 values(i,u,k,a,dest,cat,amount,q,fb,fu,occurred,coalesce(p->>'note',''),historical,false,coalesce(old.version,0)+1,p->>'recurring_key')
 on conflict(id) do update set kind=excluded.kind,account_id=excluded.account_id,destination_id=excluded.destination_id,category_id=excluded.category_id,amount_bob=excluded.amount_bob,usdt_quantity=excluded.usdt_quantity,fee_bob=excluded.fee_bob,fee_usdt=excluded.fee_usdt,occurred_at=excluded.occurred_at,note=excluded.note,history_only=excluded.history_only,voided=false,version=excluded.version,recurring_key=excluded.recurring_key;
end $$;

create function finance.rebuild(u uuid) returns void language plpgsql set search_path='' as $$
declare m public.movements;l public.usdt_lots;needed numeric;used numeric;cost numeric;unknown numeric;total numeric;assigned numeric;
begin
 delete from public.account_entries where user_id=u;delete from public.usdt_consumptions where user_id=u;delete from public.usdt_lots where user_id=u;
 update public.movements set fifo_cost=null,unknown_quantity=0,realized_profit=null where user_id=u;
 for m in select * from public.movements where user_id=u and not voided order by occurred_at,id loop
  if not m.history_only then
   if m.kind in ('expense','buy','transfer') then insert into public.account_entries(user_id,movement_id,account_id,amount) values(u,m.id,m.account_id,-m.amount_bob-m.fee_bob);end if;
   if m.kind in ('income','sell') then insert into public.account_entries(user_id,movement_id,account_id,amount) values(u,m.id,m.account_id,m.amount_bob-m.fee_bob);end if;
   if m.kind='transfer' then insert into public.account_entries(user_id,movement_id,account_id,amount) values(u,m.id,m.destination_id,m.amount_bob);end if;
   if m.kind='adjustment' then insert into public.account_entries(user_id,movement_id,account_id,amount) values(u,m.id,m.account_id,m.amount_bob);end if;
  end if;
  if m.kind in ('buy','opening') then
   insert into public.usdt_lots values(m.id,u,m.occurred_at,m.usdt_quantity-m.fee_usdt,m.usdt_quantity-m.fee_usdt,case when m.amount_bob is null then null else (m.amount_bob+m.fee_bob)/(m.usdt_quantity-m.fee_usdt) end);
  elsif m.kind='sell' then
   needed=m.usdt_quantity+m.fee_usdt;cost=0;unknown=0;
   for l in select * from public.usdt_lots where user_id=u and remaining>0 order by occurred_at,id loop
    exit when needed<=0;used=least(needed,l.remaining);
    insert into public.usdt_consumptions(user_id,movement_id,lot_id,quantity,cost) values(u,m.id,l.id,used,used*l.unit_cost);
    update public.usdt_lots set remaining=remaining-used where id=l.id and user_id=u;
    if l.unit_cost is null then unknown=unknown+used;else cost=cost+used*l.unit_cost;end if;
    needed=needed-used;
   end loop;
   if needed>0 then raise exception 'No tienes suficientes USDT para esta venta, incluida su comisión.';end if;
   update public.movements set fifo_cost=cost,unknown_quantity=unknown,realized_profit=case when unknown>0 then null else m.amount_bob-m.fee_bob-cost end where id=m.id and user_id=u;
  end if;
 end loop;
 select coalesce(sum(remaining),0) into total from public.usdt_lots where user_id=u;
 select coalesce(sum(reserved_usdt),0) into assigned from public.goals where user_id=u and not archived;
 if assigned>total then raise exception 'Libera USDT de tus metas antes de reducir este saldo.';end if;
end $$;

-- The definer lives in an unexposed schema and is needed because clients have no direct ledger write grants.
-- Its public wrapper uses invoker privileges; this boundary verifies auth.uid() and ownership on every command.
create function finance.apply_command(command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=auth.uid();p jsonb=command->'payload';typ text=command->>'type';e text=command->>'entity';i uuid=(command->>'id')::uuid;expected integer=(command->>'expected_version')::integer;hash text=md5(command::text);result jsonb;v integer;item jsonb;r public.recurring;next_month date;
begin
 if u is null then raise exception 'Inicia sesión para continuar.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0));
 select receipt.result into result from finance.command_receipts receipt where receipt.user_id=u and command_hash=hash;
 if result is not null then return result;end if;
 if typ='bootstrap' then
  if exists(select 1 from public.profiles where user_id=u and onboarded)then raise exception 'Esta cuenta ya está configurada.';end if;
  if jsonb_array_length(p->'accounts')<1 then raise exception 'Añade al menos una cuenta.';end if;
  perform finance.save_entity(u,'profile',p->'profile');
  for item in select value from jsonb_array_elements(p->'accounts')loop perform finance.save_entity(u,'account',item);end loop;
  for item in select value from jsonb_array_elements(p->'categories')loop perform finance.save_entity(u,'category',item);end loop;
  for item in select value from jsonb_array_elements(p->'movements')loop perform finance.save_movement(u,item);end loop;
 elsif typ='movement' then
  if i<>(p->>'id')::uuid then raise exception 'Identificador inválido.';end if;
  perform finance.save_movement(u,p,expected);
  if expected is null and p->>'recurring_key' is not null then
   select * into r from public.recurring where user_id=u and not archived and id::text||':'||next_date::text=p->>'recurring_key';
   if r.id is not null then
    if p->>'kind'<>'expense' or (p->>'account_id')::uuid<>r.account_id or (p->>'category_id')::uuid<>r.category_id or (p->>'amount_bob')::numeric<>r.amount then raise exception 'El pago no coincide con el recurrente.';end if;
    if r.frequency='weekly' then next_month=r.next_date+7;
    else next_month=(date_trunc('month',r.next_date)+case when r.frequency='yearly' then interval '1 year' else interval '1 month' end)::date;
     next_month=next_month+least(r.anchor_day,extract(day from next_month+interval '1 month'-interval '1 day')::int)-1;
    end if;
    update public.recurring set next_date=next_month,version=version+1 where id=r.id and user_id=u;
   end if;
  end if;
 elsif typ='void' then
  select version into v from public.movements where id=i and user_id=u;
  if v is null then raise exception 'No encontramos el movimiento.';end if;
  if v is distinct from expected then raise exception 'conflicto: el movimiento cambió en otro dispositivo.';end if;
  update public.movements set voided=true,version=version+1 where id=i and user_id=u;
 elsif typ='entity' then
  if e<>'profile' and i<>(p->>'id')::uuid then raise exception 'Identificador inválido.';end if;
  perform finance.save_entity(u,e,p,expected);
 else raise exception 'Operación inválida.';
 end if;
 if typ<>'entity' or e='goal' then perform finance.rebuild(u);end if;
 result=jsonb_build_object('id',i,'ok',true);
 insert into finance.command_receipts(user_id,command_hash,result)values(u,hash,result);
 return result;
end $$;
revoke all on all functions in schema finance from public, anon, authenticated;
grant usage on schema finance to authenticated;
grant execute on function finance.apply_command(jsonb) to authenticated;
create function public.apply_finance_command(command jsonb)returns jsonb language sql security invoker set search_path='' as $$ select finance.apply_command(command); $$;
revoke all on function public.apply_finance_command(jsonb) from public, anon;
grant execute on function public.apply_finance_command(jsonb) to authenticated;

create function public.read_finance_state()returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.profiles p where user_id=auth.uid()),
 'accounts',coalesce((select jsonb_agg((to_jsonb(a)-'user_id')||jsonb_build_object('opening_balance',opening_balance::text))from public.accounts a where user_id=auth.uid()),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c)-'user_id')from public.categories c where user_id=auth.uid()),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg((to_jsonb(m)-'user_id'-'fifo_cost'-'unknown_quantity'-'realized_profit')||jsonb_build_object('amount_bob',amount_bob::text,'usdt_quantity',usdt_quantity::text,'fee_bob',fee_bob::text,'fee_usdt',fee_usdt::text))from public.movements m where user_id=auth.uid()),'[]'::jsonb),
 'goals',coalesce((select jsonb_agg((to_jsonb(g)-'user_id')||jsonb_build_object('target_amount',target_amount::text,'reserved_usdt',reserved_usdt::text))from public.goals g where user_id=auth.uid()),'[]'::jsonb),
 'budgets',coalesce((select jsonb_agg((to_jsonb(b)-'user_id')||jsonb_build_object('amount',amount::text))from public.budgets b where user_id=auth.uid()),'[]'::jsonb),
 'recurring',coalesce((select jsonb_agg((to_jsonb(r)-'user_id')||jsonb_build_object('amount',amount::text))from public.recurring r where user_id=auth.uid()),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg((to_jsonb(q)-'user_id')||jsonb_build_object('price',price::text,'quantity',quantity::text))from public.quotes q where user_id=auth.uid()),'[]'::jsonb));
$$;
revoke all on function public.read_finance_state()from public,anon;
grant execute on function public.read_finance_state()to authenticated;
