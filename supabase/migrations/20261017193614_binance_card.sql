-- A completed Binance Card purchase is a personal expense funded by USDT.
alter table public.movements drop constraint movements_kind_check;
alter table public.movements add constraint movements_kind_check
  check (kind in ('expense','income','transfer','buy','sell','card','opening','adjustment'));
alter table public.movements
  add column card_amount numeric(28,2),
  add column card_currency text;
alter table public.movements add constraint movements_card_fields_check check (
  (kind='card' and card_amount>0 and card_currency ~ '^[A-Z]{3}$' and account_id is null and destination_id is null and category_id is not null and not history_only)
  or (kind<>'card' and card_amount is null and card_currency is null)
);

create or replace function finance.save_movement(u uuid,p jsonb,expected integer default null) returns void language plpgsql set search_path='' as $$
declare old public.movements; i uuid=(p->>'id')::uuid; k text=p->>'kind'; a uuid=(p->>'account_id')::uuid; dest uuid=(p->>'destination_id')::uuid; cat uuid=(p->>'category_id')::uuid;
 amount numeric=(p->>'amount_bob')::numeric;q numeric=(p->>'usdt_quantity')::numeric;fb numeric=(p->>'fee_bob')::numeric;fu numeric=(p->>'fee_usdt')::numeric;
 card_amt numeric=(p->>'card_amount')::numeric;card_cur text=p->>'card_currency';
 historical boolean=(p->>'history_only')::boolean;occurred timestamptz=(p->>'occurred_at')::timestamptz;cut date;day date;
begin
 select * into old from public.movements where id=i;
 if old.id is not null and old.user_id<>u then raise exception 'Este movimiento no te pertenece.';end if;
 if old.id is not null and expected is distinct from old.version then raise exception 'conflicto: el movimiento cambió en otro dispositivo.';end if;
 if old.id is null and expected is not null then raise exception 'conflicto: el movimiento ya no existe.';end if;
 if k not in ('expense','income','transfer','buy','sell','card','opening','adjustment') then raise exception 'Tipo de movimiento inválido.';end if;
 if q is null or fb is null or fu is null or q<0 or fb<0 or fu<0 or q<>round(q,8) or fu<>round(fu,8) or fb<>round(fb,2) then raise exception 'Cantidades o comisiones inválidas.';end if;
 if amount is not null and amount<>round(amount,2) then raise exception 'BOB admite dos decimales.';end if;
 if k<>'opening' then
  if k<>'card' then perform finance.assert_owner(u,'accounts',a,old.id is null);elsif a is not null then raise exception 'La tarjeta descuenta USDT, no una cuenta bancaria.';end if;
  if amount is null or(k<>'adjustment' and amount<=0)then raise exception 'El importe debe ser mayor que cero.';end if;
 end if;
 if k='card' then
  if card_amt is null or card_amt<=0 or card_amt<>round(card_amt,2) or card_cur is null or card_cur !~ '^[A-Z]{3}$' then raise exception 'Indica el importe y la moneda del comercio.';end if;
  if card_cur='BOB' and card_amt<>amount then raise exception 'El importe del comercio en BOB debe coincidir con el gasto.';end if;
 elsif card_amt is not null or card_cur is not null then raise exception 'Solo la tarjeta utiliza importe del comercio.';end if;
 if k='opening' and(amount<0 or not historical)then raise exception 'La apertura pertenece al historial inicial.';end if;
 if k in ('expense','income','card') then
  perform finance.assert_owner(u,'categories',cat,old.id is null);
  if(select type from public.categories where id=cat)<>(case when k='card' then 'expense' else k end) then raise exception 'Categoría incompatible con el movimiento.';end if;
 elsif cat is not null then raise exception 'Esta operación no utiliza categoría.';end if;
 if k='transfer' then perform finance.assert_owner(u,'accounts',dest,old.id is null);if dest=a then raise exception 'Elige otra cuenta de destino.';end if;elsif dest is not null then raise exception 'Destino inesperado.';end if;
 if k in ('buy','sell','opening','card') then if q<=0 or(k in ('buy','opening') and q-fu<=0)then raise exception 'Los USDT netos deben ser mayores que cero.';end if;elsif q<>0 or fu<>0 then raise exception 'Esta operación no usa USDT.';end if;
 if k in ('expense','income','adjustment','opening','card') and fb<>0 then raise exception 'Registra la comisión como gasto separado.';end if;
 if k='sell' and fb>amount then raise exception 'La comisión supera el importe recibido.';end if;
 if historical and k not in ('buy','sell','opening') then raise exception 'Historial inicial inválido.';end if;
 select cutoff into cut from public.profiles where user_id=u;
 if cut is null then raise exception 'Configura tu espacio antes de registrar movimientos.';end if;
 day=(occurred at time zone 'America/La_Paz')::date;
 if historical and day>cut then raise exception 'El historial debe ser anterior a la fecha de corte.';end if;
 if not historical and day<cut then raise exception 'El movimiento es anterior a la fecha de inicio.';end if;
 insert into public.movements(id,user_id,kind,account_id,destination_id,category_id,amount_bob,usdt_quantity,fee_bob,fee_usdt,occurred_at,note,history_only,voided,version,recurring_key,card_amount,card_currency)
 values(i,u,k,a,dest,cat,amount,q,fb,fu,occurred,coalesce(p->>'note',''),historical,false,coalesce(old.version,0)+1,p->>'recurring_key',card_amt,card_cur)
 on conflict(id) do update set kind=excluded.kind,account_id=excluded.account_id,destination_id=excluded.destination_id,category_id=excluded.category_id,amount_bob=excluded.amount_bob,usdt_quantity=excluded.usdt_quantity,fee_bob=excluded.fee_bob,fee_usdt=excluded.fee_usdt,occurred_at=excluded.occurred_at,note=excluded.note,history_only=excluded.history_only,voided=false,version=excluded.version,recurring_key=excluded.recurring_key,card_amount=excluded.card_amount,card_currency=excluded.card_currency;
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
  if m.kind in ('buy','opening') then
   insert into public.usdt_lots values(m.id,u,m.occurred_at,m.usdt_quantity-m.fee_usdt,m.usdt_quantity-m.fee_usdt,case when m.amount_bob is null then null else (m.amount_bob+m.fee_bob)/(m.usdt_quantity-m.fee_usdt) end);
  elsif m.kind in ('sell','card') then
   needed=m.usdt_quantity+m.fee_usdt;cost=0;unknown=0;
   for l in select * from public.usdt_lots where user_id=u and remaining>0 order by occurred_at,id loop
    exit when needed<=0;used=least(needed,l.remaining);
    insert into public.usdt_consumptions(user_id,movement_id,lot_id,quantity,cost) values(u,m.id,l.id,used,used*l.unit_cost);
    update public.usdt_lots set remaining=remaining-used where id=l.id and user_id=u;
    if l.unit_cost is null then unknown=unknown+used;else cost=cost+used*l.unit_cost;end if;
    needed=needed-used;
   end loop;
   if needed>0 then raise exception 'No tienes suficientes USDT para esta operación, incluida su comisión.';end if;
   update public.movements set fifo_cost=cost,unknown_quantity=unknown,realized_profit=case when unknown>0 then null else m.amount_bob-m.fee_bob-cost end where id=m.id and user_id=u;
  end if;
 end loop;
 select coalesce(sum(remaining),0) into total from public.usdt_lots where user_id=u;
 select coalesce(sum(reserved_usdt),0) into assigned from public.goals where user_id=u and not archived;
 if assigned>total then raise exception 'Libera USDT de tus metas antes de reducir este saldo.';end if;
end $$;

create or replace function public.read_finance_state()returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'profile',(select to_jsonb(p)-'user_id' from public.profiles p where user_id=auth.uid()),
 'accounts',coalesce((select jsonb_agg((to_jsonb(a)-'user_id')||jsonb_build_object('opening_balance',opening_balance::text))from public.accounts a where user_id=auth.uid()),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c)-'user_id')from public.categories c where user_id=auth.uid()),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg((to_jsonb(m)-'user_id'-'fifo_cost'-'unknown_quantity'-'realized_profit')||jsonb_build_object('amount_bob',amount_bob::text,'card_amount',card_amount::text,'usdt_quantity',usdt_quantity::text,'fee_bob',fee_bob::text,'fee_usdt',fee_usdt::text))from public.movements m where user_id=auth.uid()),'[]'::jsonb),
 'goals',coalesce((select jsonb_agg((to_jsonb(g)-'user_id')||jsonb_build_object('target_amount',target_amount::text,'reserved_usdt',reserved_usdt::text))from public.goals g where user_id=auth.uid()),'[]'::jsonb),
 'budgets',coalesce((select jsonb_agg((to_jsonb(b)-'user_id')||jsonb_build_object('amount',amount::text))from public.budgets b where user_id=auth.uid()),'[]'::jsonb),
 'recurring',coalesce((select jsonb_agg((to_jsonb(r)-'user_id')||jsonb_build_object('amount',amount::text))from public.recurring r where user_id=auth.uid()),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg((to_jsonb(q)-'user_id')||jsonb_build_object('price',price::text,'quantity',quantity::text))from public.quotes q where user_id=auth.uid()),'[]'::jsonb));
$$;
