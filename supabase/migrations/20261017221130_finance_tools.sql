
-- Personal tools, portable backups and isolated crypto receipts.
alter table public.movements drop constraint movements_kind_check;
alter table public.movements add constraint movements_kind_check check(kind in ('expense','income','transfer','buy','sell','card','opening','adjustment','crypto_in','crypto_out','refund','cashback'));
alter table public.movements add column asset text not null default 'USDT' check(asset in ('USDT','USDC')), add column parent_id uuid references public.movements(id);
create index movements_parent_idx on public.movements(parent_id);
alter table public.usdt_lots add column asset text not null default 'USDT' check(asset in ('USDT','USDC'));
create table public.finance_planning(user_id uuid primary key references auth.users(id) on delete cascade,data jsonb not null,version integer not null default 1 check(version>0));
alter table public.finance_planning enable row level security;
create policy own_planning on public.finance_planning for select to authenticated using((select auth.uid())=user_id);
revoke all on public.finance_planning from public,anon,authenticated;
grant select on public.finance_planning to authenticated;
create or replace function finance.write_movement(u uuid,p jsonb,expected integer,restoring boolean) returns void language plpgsql set search_path='' as $$
declare old public.movements; i uuid=(p->>'id')::uuid; k text=p->>'kind'; a uuid=(p->>'account_id')::uuid; dest uuid=(p->>'destination_id')::uuid; cat uuid=(p->>'category_id')::uuid;
 amount numeric=(p->>'amount_bob')::numeric;q numeric=(p->>'usdt_quantity')::numeric;fb numeric=(p->>'fee_bob')::numeric;fu numeric=(p->>'fee_usdt')::numeric;
 asset_name text=coalesce(p->>'asset','USDT');parent uuid=(p->>'parent_id')::uuid;original public.movements;refund_total numeric;
 card_amt numeric=(p->>'card_amount')::numeric;card_cur text=p->>'card_currency';
 historical boolean=(p->>'history_only')::boolean;occurred timestamptz=(p->>'occurred_at')::timestamptz;cut date;day date;
begin
 select * into old from public.movements where id=i;
 if old.id is not null and old.user_id<>u then raise exception 'Este movimiento no te pertenece.';end if;
 if old.id is not null and expected is distinct from old.version then raise exception 'conflicto: el movimiento cambió en otro dispositivo.';end if;
 if old.id is null and expected is not null then raise exception 'conflicto: el movimiento ya no existe.';end if;

 if asset_name not in ('USDT','USDC') then raise exception 'Activo inválido.';end if;
 if (p->>'usdt_quantity') !~ '^\d+(\.\d{1,8})?$' or (p->>'fee_usdt') !~ '^\d+(\.\d{1,8})?$' or (p->>'fee_bob') !~ '^\d+(\.\d{1,2})?$' or (p->>'amount_bob' is not null and (p->>'amount_bob') !~ '^-?\d+(\.\d{1,2})?$') then raise exception 'Formato decimal inválido.';end if;
 if k in ('crypto_in','crypto_out','refund','cashback') then
  if a is not null or dest is not null or historical or card_amt is not null or card_cur is not null or q is null or q<=0 or fu<>0 or fb<>0 or length(trim(coalesce(p->>'note','')))=0 then raise exception 'Revisa los datos del movimiento de criptomonedas.';end if;
  if amount is not null and amount<0 then raise exception 'El costo no puede ser negativo.';end if;
  if k='crypto_out' and amount is not null then raise exception 'Un ajuste de salida no tiene ingreso BOB.';end if;
  if k='refund' then
   select * into original from public.movements where id=parent and user_id=u and kind='card' and (not voided or (restoring and coalesce((p->>'voided')::boolean,false)));
   if original.id is null or cat is distinct from original.category_id or amount is null or amount<=0 or occurred<original.occurred_at then raise exception 'Selecciona un consumo válido y el importe devuelto.';end if;
   select coalesce(sum(amount_bob),0) into refund_total from public.movements where user_id=u and kind='refund' and parent_id=parent and not voided and id<>i;
   if not restoring and amount+refund_total>original.amount_bob then raise exception 'Las devoluciones superan el consumo original.';end if;
  elsif parent is not null or cat is not null then raise exception 'Referencia de devolución inesperada.';end if;
 else
  if asset_name<>'USDT' or parent is not null then raise exception 'Esta operación solo admite USDT y no utiliza consumo original.';end if;
 if k not in ('expense','income','transfer','buy','sell','card','opening','adjustment') then raise exception 'Tipo de movimiento inválido.';end if;
 if q is null or fb is null or fu is null or q<0 or fb<0 or fu<0 or q<>round(q,8) or fu<>round(fu,8) or fb<>round(fb,2) then raise exception 'Cantidades o comisiones inválidas.';end if;
 if amount is not null and amount<>round(amount,2) then raise exception 'BOB admite dos decimales.';end if;
 if k<>'opening' then
  if k<>'card' then perform finance.assert_owner(u,'accounts',a,old.id is null and not restoring);elsif a is not null then raise exception 'La tarjeta descuenta USDT, no una cuenta bancaria.';end if;
  if amount is null or(k<>'adjustment' and amount<=0)then raise exception 'El importe debe ser mayor que cero.';end if;
 end if;
 if k='card' then
  if card_amt is null or card_amt<=0 or card_amt<>round(card_amt,2) or card_cur is null or card_cur !~ '^[A-Z]{3}$' then raise exception 'Indica el importe y la moneda del comercio.';end if;
  if card_cur='BOB' and card_amt<>amount then raise exception 'El importe del comercio en BOB debe coincidir con el gasto.';end if;
 elsif card_amt is not null or card_cur is not null then raise exception 'Solo la tarjeta utiliza importe del comercio.';end if;
 if k='opening' and(amount<0 or not historical)then raise exception 'La apertura pertenece al historial inicial.';end if;
 if k in ('expense','income','card') then
  perform finance.assert_owner(u,'categories',cat,old.id is null and not restoring);
  if(select type from public.categories where id=cat)<>(case when k='card' then 'expense' else k end) then raise exception 'Categoría incompatible con el movimiento.';end if;
 elsif cat is not null then raise exception 'Esta operación no utiliza categoría.';end if;
 if k='transfer' then perform finance.assert_owner(u,'accounts',dest,old.id is null and not restoring);if dest=a then raise exception 'Elige otra cuenta de destino.';end if;elsif dest is not null then raise exception 'Destino inesperado.';end if;
 if k in ('buy','sell','opening','card') then if q<=0 or(k in ('buy','opening') and q-fu<=0)then raise exception 'Los USDT netos deben ser mayores que cero.';end if;elsif q<>0 or fu<>0 then raise exception 'Esta operación no usa USDT.';end if;
 if k in ('expense','income','adjustment','opening','card') and fb<>0 then raise exception 'Registra la comisión como gasto separado.';end if;
 if k='sell' and fb>amount then raise exception 'La comisión supera el importe recibido.';end if;
 if historical and k not in ('buy','sell','opening') then raise exception 'Historial inicial inválido.';end if;
 end if;
 select cutoff into cut from public.profiles where user_id=u;
 if cut is null then raise exception 'Configura tu espacio antes de registrar movimientos.';end if;
 day=(occurred at time zone 'America/La_Paz')::date;
 if historical and day>cut then raise exception 'El historial debe ser anterior a la fecha de corte.';end if;
 if not historical and day<cut then raise exception 'El movimiento es anterior a la fecha de inicio.';end if;
 insert into public.movements(id,user_id,kind,account_id,destination_id,category_id,amount_bob,usdt_quantity,fee_bob,fee_usdt,occurred_at,note,history_only,voided,version,recurring_key,card_amount,card_currency,asset,parent_id)
 values(i,u,k,a,dest,cat,amount,q,fb,fu,occurred,coalesce(p->>'note',''),historical,case when restoring then coalesce((p->>'voided')::boolean,false) else false end,coalesce(old.version,0)+1,p->>'recurring_key',card_amt,card_cur,asset_name,parent)
 on conflict(id) do update set kind=excluded.kind,account_id=excluded.account_id,destination_id=excluded.destination_id,category_id=excluded.category_id,amount_bob=excluded.amount_bob,usdt_quantity=excluded.usdt_quantity,fee_bob=excluded.fee_bob,fee_usdt=excluded.fee_usdt,occurred_at=excluded.occurred_at,note=excluded.note,history_only=excluded.history_only,voided=false,version=excluded.version,recurring_key=excluded.recurring_key,card_amount=excluded.card_amount,card_currency=excluded.card_currency,asset=excluded.asset,parent_id=excluded.parent_id;
end $$;
create or replace function finance.rebuild(u uuid) returns void language plpgsql set search_path='' as $$
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
  if m.kind in ('buy','opening','crypto_in','refund','cashback') then
   insert into public.usdt_lots values(m.id,u,m.occurred_at,m.usdt_quantity-m.fee_usdt,m.usdt_quantity-m.fee_usdt,case when m.amount_bob is null then null else (m.amount_bob+m.fee_bob)/(m.usdt_quantity-m.fee_usdt) end,m.asset);
  elsif m.kind in ('sell','card','crypto_out') then
   needed=m.usdt_quantity+m.fee_usdt;cost=0;unknown=0;
   for l in select * from public.usdt_lots where user_id=u and asset=m.asset and remaining>0 order by occurred_at,id loop
    exit when needed<=0;used=least(needed,l.remaining);
    insert into public.usdt_consumptions(user_id,movement_id,lot_id,quantity,cost) values(u,m.id,l.id,used,used*l.unit_cost);
    update public.usdt_lots set remaining=remaining-used where id=l.id and user_id=u;
    if l.unit_cost is null then unknown=unknown+used;else cost=cost+used*l.unit_cost;end if;
    needed=needed-used;
   end loop;
   if needed>0 then raise exception 'No tienes suficientes USDT para esta operación, incluida su comisión.';end if;
   update public.movements set fifo_cost=cost,unknown_quantity=unknown,realized_profit=case when unknown>0 or m.kind='crypto_out' then null else m.amount_bob-m.fee_bob-cost end where id=m.id and user_id=u;
  end if;
 end loop;

 if exists(select 1 from public.movements r left join public.movements c on c.id=r.parent_id and c.user_id=u where r.user_id=u and r.kind='refund' and not r.voided and (c.id is null or c.voided or c.kind<>'card' or r.category_id is distinct from c.category_id or r.occurred_at<c.occurred_at)) then raise exception 'Hay una devolución sin consumo válido.';end if;
 if exists(select 1 from public.movements r join public.movements c on c.id=r.parent_id and c.user_id=u where r.user_id=u and r.kind='refund' and not r.voided group by r.parent_id,c.amount_bob having sum(r.amount_bob)>c.amount_bob)then raise exception 'Las devoluciones superan el consumo original.';end if;
 select coalesce(sum(remaining),0) into total from public.usdt_lots where user_id=u and asset='USDT';
 select coalesce(sum(reserved_usdt),0) into assigned from public.goals where user_id=u and not archived;
 if assigned>total then raise exception 'Libera USDT de tus metas antes de reducir este saldo.';end if;
end $$;

create or replace function finance.save_movement(u uuid,p jsonb,expected integer default null) returns void language sql set search_path='' as $$ select finance.write_movement(u,p,expected,false); $$;

create function finance.check_planning(u uuid,p jsonb) returns void language plpgsql set search_path='' as $$
declare d jsonb;pay jsonb;draft jsonb;recon jsonb;m public.movements;paid numeric;principal numeric;linked text[]='{}';mid text;expected numeric;key text;
begin
 if not (p ?& array['debts','card_drafts','reconciliations','usdc_reference']) or jsonb_typeof(p->'debts')<>'array' or jsonb_typeof(p->'card_drafts')<>'array' or jsonb_typeof(p->'reconciliations')<>'array' or jsonb_array_length(p->'debts')>500 or jsonb_array_length(p->'card_drafts')>1000 or jsonb_array_length(p->'reconciliations')>5000 or octet_length(p::text)>1500000 then raise exception 'Herramientas inválidas o demasiado grandes.';end if;
 for key in select unnest(array['debts','card_drafts','reconciliations']) loop
  if (select count(distinct value->>'id')from jsonb_array_elements(p->key))<>jsonb_array_length(p->key)then raise exception 'Identificadores de herramientas repetidos o ausentes.';end if;
  for d in select value from jsonb_array_elements(p->key)loop perform (d->>'id')::uuid;end loop;
 end loop;
 for d in select value from jsonb_array_elements(p->'debts') loop
  if not(d ?& array['id','name','direction','principal','due_date','note','archived','opening_movement_id','payments'])or jsonb_typeof(d->'name')<>'string' or jsonb_typeof(d->'principal')<>'string' or jsonb_typeof(d->'archived')<>'boolean' or (d->>'principal') !~ '^\d+(\.\d{1,2})?$' or (d->>'principal')::numeric<=0 or d->>'direction' not in ('receivable','payable') or length(trim(d->>'name')) not between 1 and 120 or jsonb_typeof(d->'payments')<>'array' or jsonb_array_length(d->'payments')>1000 then raise exception 'Deuda inválida.';end if;
  if d->>'direction' is null or jsonb_typeof(d->'note')<>'string' or length(d->>'note')>1000 then raise exception 'Deuda inválida.';end if;
  if d->>'due_date' is not null then perform (d->>'due_date')::date;end if;
  if (select count(distinct value->>'id')from jsonb_array_elements(d->'payments'))<>jsonb_array_length(d->'payments')then raise exception 'Pagos repetidos o sin identificador.';end if;
  principal=(d->>'principal')::numeric;paid=0;
  if d->>'opening_movement_id' is not null then
   mid=d->>'opening_movement_id';select * into m from public.movements where id=mid::uuid and user_id=u and not voided;
   expected=principal*case when d->>'direction'='receivable' then -1 else 1 end;
   if mid=any(linked) or m.id is null or m.kind<>'adjustment' or m.amount_bob<>expected then raise exception 'El movimiento inicial de la deuda no coincide.';end if;
   linked=array_append(linked,mid);
  end if;
  for pay in select value from jsonb_array_elements(d->'payments') loop
   perform (pay->>'id')::uuid;
   if not(pay ?& array['id','amount','date','account_id','movement_id'])or jsonb_typeof(pay->'amount')<>'string' or pay->>'movement_id' is null or pay->>'date' is null or pay->>'account_id' is null or (pay->>'amount') !~ '^\d+(\.\d{1,2})?$' or (pay->>'amount')::numeric<=0 then raise exception 'Pago inválido.';end if;
   mid=pay->>'movement_id';select * into m from public.movements where id=mid::uuid and user_id=u and not voided;
   expected=(pay->>'amount')::numeric*case when d->>'direction'='receivable' then 1 else -1 end;
   if mid=any(linked) or m.id is null or m.kind<>'adjustment' or m.amount_bob<>expected or m.account_id is distinct from (pay->>'account_id')::uuid or (m.occurred_at at time zone 'America/La_Paz')::date<>(pay->>'date')::date then raise exception 'Gestiona los pagos vinculados desde Deudas.';end if;
   linked=array_append(linked,mid);paid=paid+(pay->>'amount')::numeric;
  end loop;
  if paid>principal or ((d->>'archived')::boolean and paid<>principal) then raise exception 'La deuda tiene pagos excesivos o sigue pendiente.';end if;
 end loop;
 for draft in select value from jsonb_array_elements(p->'card_drafts') loop
  if not(draft ?& array['id','note','amount_bob','usdt_quantity','category_id','date','card_currency','card_amount','status'])or draft->>'status' is null or draft->>'category_id' is null or draft->>'date' is null or jsonb_typeof(draft->'note')<>'string' or coalesce(length(trim(draft->>'note')),0)not between 1 and 120 or coalesce(draft->>'card_currency','')!~'^[A-Z]{3}$' or coalesce(draft->>'card_amount','')!~'^\d+(\.\d{1,2})?$' or (draft->>'card_amount')::numeric<=0 or coalesce(draft->>'amount_bob','')!~'^\d+(\.\d{1,2})?$' or coalesce(draft->>'usdt_quantity','')!~'^\d+(\.\d{1,8})?$' then raise exception 'Cargo pendiente incompleto.';end if;
  perform (draft->>'date')::date;
  if draft->>'status' not in ('pending','cancelled','completed') or (draft->>'amount_bob') !~ '^\d+(\.\d{1,2})?$' or (draft->>'amount_bob')::numeric<=0 or (draft->>'usdt_quantity') !~ '^\d+(\.\d{1,8})?$' or (draft->>'usdt_quantity')::numeric<=0 then raise exception 'Cargo pendiente inválido.';end if;
  perform finance.assert_owner(u,'categories',(draft->>'category_id')::uuid,false);
  if not exists(select 1 from public.categories where id=(draft->>'category_id')::uuid and user_id=u and type='expense')then raise exception 'La categoría del cargo debe ser un gasto.';end if;
  if draft->>'status'='completed' and not exists(select 1 from public.movements where user_id=u and id=(draft->>'id')::uuid and kind='card' and not voided and amount_bob=(draft->>'amount_bob')::numeric and usdt_quantity=(draft->>'usdt_quantity')::numeric and card_amount=(draft->>'card_amount')::numeric and card_currency=draft->>'card_currency' and category_id=(draft->>'category_id')::uuid) then raise exception 'Gestiona la anulación del cargo desde Tarjeta.';end if;
 end loop;
 for recon in select value from jsonb_array_elements(p->'reconciliations') loop
  if not(recon ?& array['id','asset','recorded','observed','date','note','movement_id'])or recon->>'asset' is null or recon->>'date' is null or coalesce(length(trim(recon->>'note')),0)not between 1 and 120 or coalesce(recon->>'recorded','')!~'^\d+(\.\d{1,8})?$' or coalesce(recon->>'observed','')!~'^\d+(\.\d{1,8})?$' then raise exception 'Conciliación incompleta.';end if;
  perform (recon->>'date')::date;
  if recon->>'asset' not in ('USDT','USDC') or recon->>'recorded' !~ '^\d+(\.\d{1,8})?$' or recon->>'observed' !~ '^\d+(\.\d{1,8})?$' then raise exception 'Conciliación inválida.';end if;
  if recon->>'movement_id' is not null then
   select * into m from public.movements where user_id=u and id=(recon->>'movement_id')::uuid and not voided;
   expected=(recon->>'observed')::numeric-(recon->>'recorded')::numeric;
   if m.id is null or m.asset<>(recon->>'asset') or m.usdt_quantity<>abs(expected) or m.kind<>(case when expected>0 then 'crypto_in' else 'crypto_out' end) then raise exception 'La conciliación no coincide con su ajuste.';end if;
  end if;
 end loop;
 if p->'usdc_reference'<>'null'::jsonb then
  if jsonb_typeof(p->'usdc_reference')<>'object' or coalesce(p->'usdc_reference'->>'price','')!~'^\d+(\.\d{1,8})?$' or (p->'usdc_reference'->>'price')::numeric<=0 or p->'usdc_reference'->>'observed_at' is null then raise exception 'Referencia USDC inválida.';end if;
  perform (p->'usdc_reference'->>'observed_at')::timestamptz;
 end if;
end $$;

create function finance.save_planning(u uuid,p jsonb,expected integer) returns void language plpgsql set search_path='' as $$
declare v integer;
begin
 select version into v from public.finance_planning where user_id=u;
 if v is distinct from expected then raise exception 'conflicto: las herramientas cambiaron en otro dispositivo.';end if;
 perform finance.check_planning(u,p);
 insert into public.finance_planning(user_id,data,version)values(u,p-'version',coalesce(v,0)+1)on conflict(user_id)do update set data=excluded.data,version=excluded.version;
end $$;

alter function public.read_finance_state() set schema finance;
alter function finance.read_finance_state() rename to read_state_base;
create function public.read_finance_state()returns jsonb language sql stable security invoker set search_path='' as $$
 select finance.read_state_base() || jsonb_build_object('planning',coalesce((select data||jsonb_build_object('version',version) from public.finance_planning where user_id=auth.uid()),'{"version":0,"debts":[],"card_drafts":[],"reconciliations":[],"usdc_reference":null}'::jsonb));
$$;
-- Include new quantities as strings while keeping the existing RPC layout.
create function finance.read_backup()returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión.';end if;
 return jsonb_build_object('state',public.read_finance_state(),'revision',(select count(*) from finance.command_receipts where user_id=auth.uid()));
end $$;
create function public.read_finance_backup()returns jsonb language sql security invoker set search_path='' as $$select finance.read_backup();$$;

alter function finance.apply_command(jsonb) rename to apply_legacy_command;
create function finance.apply_command(command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=auth.uid();typ text=command->>'type';p jsonb=command->'payload';hash text=md5(command::text);result jsonb;child jsonb;item jsonb;key text;expected integer=(command->>'expected_version')::integer;v integer;archive_accounts uuid[];archive_categories uuid[];state jsonb;
begin
 if u is null then raise exception 'Inicia sesión para continuar.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,0));
 select receipt.result into result from finance.command_receipts receipt where user_id=u and command_hash=hash;
 if result is not null then return result;end if;
 if octet_length(command::text)>3500000 then raise exception 'El archivo supera el límite de 3 MB.';end if;
 if typ='batch' then
  if jsonb_typeof(p->'commands')<>'array' or jsonb_array_length(p->'commands') not between 1 and 1000 then raise exception 'Lote inválido.';end if;
  if p->'expected_inventory' is not null then
   for key in select jsonb_object_keys(p->'expected_inventory')loop
    if key not in ('USDT','USDC')or coalesce(p->'expected_inventory'->>key,'')!~'^\d+(\.\d{1,8})?$' then raise exception 'Saldo de conciliación inválido.';end if;
    if (select coalesce(sum(remaining),0) from public.usdt_lots where user_id=u and asset=key)<>(p->'expected_inventory'->>key)::numeric then raise exception 'conflicto: el saldo cambió. Vuelve a conciliar.';end if;
   end loop;
  end if;
  for child in select value from jsonb_array_elements(p->'commands')loop
   if child->>'type' not in ('movement','void','entity','planning')then raise exception 'Operación no permitida en lote.';end if;
   perform finance.apply_command(child);
  end loop;
 elsif typ='planning' then
  perform finance.save_planning(u,p,expected);
 elsif typ='restore' then
  if (p->>'expected_revision')::bigint is distinct from (select count(*) from finance.command_receipts where user_id=u)then raise exception 'conflicto: tus datos cambiaron. Genera otra vista previa.';end if;
  state=p->'state';
  if not exists(select 1 from public.profiles where user_id=u)then perform finance.save_entity(u,'profile',state->'profile');
  elsif (select cutoff from public.profiles where user_id=u) is distinct from (state->'profile'->>'cutoff')::date then raise exception 'Las fechas de inicio no coinciden. Restaura en un espacio nuevo.';end if;
  select coalesce(array_agg(id),'{}')into archive_accounts from public.accounts where user_id=u and archived;
  select coalesce(array_agg(id),'{}')into archive_categories from public.categories where user_id=u and archived;
  update public.accounts set archived=false where user_id=u and archived;update public.categories set archived=false where user_id=u and archived;
  for item in select value from jsonb_array_elements(state->'accounts')loop
   if (item->>'archived')::boolean then archive_accounts=array_append(archive_accounts,(item->>'id')::uuid);end if;
   perform finance.save_entity(u,'account',item||'{"archived":false}'::jsonb);
  end loop;
  for item in select value from jsonb_array_elements(state->'categories')loop
   if (item->>'archived')::boolean then archive_categories=array_append(archive_categories,(item->>'id')::uuid);end if;
   perform finance.save_entity(u,'category',item||'{"archived":false}'::jsonb);
  end loop;
  for item in select value from jsonb_array_elements(state->'movements')order by (value->>'occurred_at')::timestamptz,value->>'id'loop perform finance.write_movement(u,item,null,true);end loop;
  for item in select value from jsonb_array_elements(state->'budgets')loop perform finance.save_entity(u,'budget',item);end loop;
  for item in select value from jsonb_array_elements(state->'recurring')loop perform finance.save_entity(u,'recurring',item);end loop;
  for item in select value from jsonb_array_elements(state->'goals')loop perform finance.save_entity(u,'goal',item);end loop;
  for item in select value from jsonb_array_elements(state->'quotes')loop perform finance.save_entity(u,'quote',item);end loop;
  update public.accounts set archived=true where user_id=u and id=any(archive_accounts);update public.categories set archived=true where user_id=u and id=any(archive_categories);
  select version into v from public.finance_planning where user_id=u;
  perform finance.save_planning(u,state->'planning',v);
  perform finance.rebuild(u);
 else
  result=finance.apply_legacy_command(command);
 end if;
 if exists(select 1 from public.finance_planning where user_id=u)then perform finance.check_planning(u,(select data from public.finance_planning where user_id=u));end if;
 result=coalesce(result,jsonb_build_object('id',command->>'id','ok',true));
 insert into finance.command_receipts(user_id,command_hash,result)values(u,hash,result)on conflict do nothing;
 return result;
end $$;
create or replace function public.apply_finance_command(command jsonb)returns jsonb language sql security invoker set search_path='' as $$select finance.apply_command(command);$$;
revoke all on all functions in schema finance from public,anon,authenticated;
grant execute on function finance.apply_command(jsonb),finance.read_state_base(),finance.read_backup() to authenticated;
revoke all on function public.read_finance_state(),public.read_finance_backup() from public,anon;
grant execute on function public.read_finance_state(),public.read_finance_backup() to authenticated;
