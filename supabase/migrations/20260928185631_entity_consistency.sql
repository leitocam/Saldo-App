-- Keep category edits and BOB goal precision consistent with the client.
create or replace function finance.save_entity(u uuid,e text,p jsonb,expected integer default null) returns void language plpgsql set search_path='' as $$
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
  on conflict(id) do update set name=excluded.name,type=excluded.type,icon=excluded.icon,color=excluded.color,favorite=excluded.favorite,position=excluded.position,archived=excluded.archived,version=excluded.version;
 elsif e='goal' then
  if p->>'target_currency'='BOB' and (p->>'target_amount')::numeric<>round((p->>'target_amount')::numeric,2) then raise exception 'BOB admite dos decimales.';end if;
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
