-- Collaborative obligations never expose personal accounts or write the personal ledger.
create table public.shared_groups(id uuid primary key,owner_id uuid not null references auth.users(id),name text not null check(length(name) between 1 and 80),archived boolean not null default false,created_at timestamptz not null default now());
create table public.shared_members(group_id uuid not null references public.shared_groups(id),user_id uuid not null references auth.users(id),display_name text not null check(length(display_name) between 1 and 80),joined_at timestamptz not null default now(),primary key(group_id,user_id));
create index shared_members_user_idx on public.shared_members(user_id,group_id);
create index shared_groups_owner_idx on public.shared_groups(owner_id);
create table public.shared_expenses(id uuid primary key,group_id uuid not null references public.shared_groups(id),paid_by uuid not null,created_by uuid not null references auth.users(id),amount numeric(28,2) not null check(amount>0),shares jsonb not null,note text not null check(length(note) between 1 and 500),date date not null,voided boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),foreign key(group_id,paid_by)references public.shared_members(group_id,user_id));
create index shared_expenses_group_idx on public.shared_expenses(group_id,date,id);
create index shared_expenses_creator_idx on public.shared_expenses(created_by);
create index shared_expenses_payer_idx on public.shared_expenses(group_id,paid_by);
create table public.shared_settlements(id uuid primary key,group_id uuid not null references public.shared_groups(id),from_id uuid not null,to_id uuid not null,amount numeric(28,2) not null check(amount>0),status text not null default 'pending' check(status in ('pending','confirmed','cancelled')),date date not null,version integer not null default 1,created_at timestamptz not null default now(),foreign key(group_id,from_id)references public.shared_members(group_id,user_id),foreign key(group_id,to_id)references public.shared_members(group_id,user_id),check(from_id<>to_id));
create index shared_settlements_group_idx on public.shared_settlements(group_id,created_at);
create index shared_settlements_from_idx on public.shared_settlements(group_id,from_id);
create index shared_settlements_to_idx on public.shared_settlements(group_id,to_id);
create table finance.shared_invites(token_hash text primary key,group_id uuid not null references public.shared_groups(id),created_by uuid not null references auth.users(id),claimed_by uuid references auth.users(id),expires_at timestamptz not null,created_at timestamptz not null default now());
create table finance.shared_receipts(user_id uuid not null references auth.users(id),command_hash text not null,result jsonb not null,primary key(user_id,command_hash));
create index shared_invites_group_idx on finance.shared_invites(group_id);
create index shared_invites_creator_idx on finance.shared_invites(created_by);
create index shared_invites_claimed_idx on finance.shared_invites(claimed_by);

create function finance.shared_member(g uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.shared_members where group_id=g and user_id=(select auth.uid()));$$;
do $$declare t text;begin
 foreach t in array array['shared_groups','shared_members','shared_expenses','shared_settlements']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy group_members_read on public.%I for select to authenticated using (finance.shared_member(%I))',t,case when t='shared_groups' then 'id' else 'group_id' end);
 end loop;
end $$;
create function finance.shared_balance(g uuid,member uuid)returns numeric language sql stable set search_path='' as $$
 select coalesce((select sum(amount)from public.shared_expenses where group_id=g and paid_by=member and not voided),0)
 -coalesce((select sum((part->>'amount')::numeric)from public.shared_expenses e cross join lateral jsonb_array_elements(e.shares)part where e.group_id=g and not e.voided and part->>'user_id'=member::text),0)
 +coalesce((select sum(amount)from public.shared_settlements where group_id=g and from_id=member and status='confirmed'),0)
 -coalesce((select sum(amount)from public.shared_settlements where group_id=g and to_id=member and status='confirmed'),0);
$$;
create function finance.shared_command(c jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid=auth.uid();act text=c->>'action';g uuid=(c->>'group_id')::uuid;i uuid=(c->>'id')::uuid;p jsonb=c->'payload';h text=md5(c::text);result jsonb;grp public.shared_groups;invite finance.shared_invites;token text;part jsonb;total numeric=0;amount numeric;recipient uuid;ex public.shared_expenses;settle public.shared_settlements;
begin
 if u is null then raise exception 'Inicia sesión para usar gastos compartidos.';end if;
 if i is null or act not in ('create','invite','join','expense','void_expense','settlement','confirm','cancel','archive')or octet_length(c::text)>100000 then raise exception 'Operación compartida inválida.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shared-user:'||u::text,0));
 select r.result into result from finance.shared_receipts r where user_id=u and command_hash=h;if result is not null then return result;end if;
 if act='create' then
  if length(trim(p->>'name'))not between 1 and 80 or length(trim(p->>'display_name'))not between 1 and 80 then raise exception 'Indica el nombre del grupo y tu nombre visible.';end if;
  if(select count(*)from public.shared_groups where owner_id=u and not archived)>=50 then raise exception 'Ya tienes 50 grupos activos.';end if;
  insert into public.shared_groups(id,owner_id,name)values(i,u,trim(p->>'name'));
  insert into public.shared_members(group_id,user_id,display_name)values(i,u,trim(p->>'display_name'));g=i;
 elsif act='join' then
  token=p->>'code';if token is null or token !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Código de invitación inválido.';end if;
  select * into invite from finance.shared_invites where token_hash=md5(token)for update;
  if invite.group_id is null or invite.expires_at<now()or invite.claimed_by is not null then raise exception 'El código venció o ya fue utilizado.';end if;g=invite.group_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shared-group:'||g::text,0));
  if not exists(select 1 from public.shared_groups where id=g and not archived)then raise exception 'El grupo no está disponible.';end if;
  if length(trim(p->>'display_name'))not between 1 and 80 then raise exception 'Indica tu nombre visible.';end if;
  if(select count(*)from public.shared_members where group_id=g)>=50 then raise exception 'El grupo alcanzó 50 integrantes.';end if;
  if exists(select 1 from public.shared_members where group_id=g and user_id=u)then raise exception 'Ya perteneces a este grupo.';end if;
  insert into public.shared_members(group_id,user_id,display_name)values(g,u,trim(p->>'display_name'));
  update finance.shared_invites set claimed_by=u where token_hash=md5(token);
 else
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shared-group:'||coalesce(g::text,''),0));
  select * into grp from public.shared_groups where id=g;
  if grp.id is null or not finance.shared_member(g)then raise exception 'No tienes acceso a este grupo.';end if;
  if grp.archived then raise exception 'Este grupo está archivado.';end if;
  if act='invite' then
   if grp.owner_id<>u then raise exception 'Solo quien creó el grupo puede invitar.';end if;
   if(select count(*)from finance.shared_invites where created_by=u and created_at>now()-interval '1 day')>=100 then raise exception 'Límite diario de invitaciones alcanzado.';end if;
   token=gen_random_uuid()::text;insert into finance.shared_invites(token_hash,group_id,created_by,expires_at)values(md5(token),g,u,now()+interval '7 days');result=jsonb_build_object('code',token,'expires_at',now()+interval '7 days');
  elsif act='expense' then
   if p->>'amount' !~ '^\d+(\.\d{1,2})?$' or (p->>'amount')::numeric<=0 or length(trim(p->>'note'))not between 1 and 500 or jsonb_typeof(p->'shares')<>'array' or jsonb_array_length(p->'shares')not between 1 and 50 then raise exception 'Gasto compartido inválido.';end if;amount=(p->>'amount')::numeric;
   if(select count(distinct value->>'user_id')from jsonb_array_elements(p->'shares'))<>jsonb_array_length(p->'shares')then raise exception 'Un participante aparece repetido.';end if;
   for part in select value from jsonb_array_elements(p->'shares')loop
    if part->>'amount' !~ '^\d+(\.\d{1,2})?$' or (part->>'amount')::numeric<0 or not exists(select 1 from public.shared_members where group_id=g and user_id=(part->>'user_id')::uuid)then raise exception 'Reparto inválido.';end if;total=total+(part->>'amount')::numeric;
   end loop;
   if total<>amount then raise exception 'Las partes no suman el total del gasto.';end if;
   insert into public.shared_expenses(id,group_id,paid_by,created_by,amount,shares,note,date)values(i,g,u,u,amount,p->'shares',trim(p->>'note'),(p->>'date')::date);
  elsif act='void_expense' then
   select * into ex from public.shared_expenses where id=i and group_id=g;
   if ex.id is null or (ex.created_by<>u and grp.owner_id<>u)then raise exception 'No puedes anular este gasto.';end if;
   if ex.version is distinct from(c->>'expected_version')::integer or ex.voided then raise exception 'conflicto: el gasto cambió.';end if;
   update public.shared_expenses set voided=true,version=version+1 where id=i;
  elsif act='settlement' then
   recipient=(p->>'to_id')::uuid;
   if p->>'amount' !~ '^\d+(\.\d{1,2})?$' or (p->>'amount')::numeric<=0 or recipient=u or not exists(select 1 from public.shared_members where group_id=g and user_id=recipient)then raise exception 'Liquidación inválida.';end if;amount=(p->>'amount')::numeric;
   if amount>least(-finance.shared_balance(g,u),finance.shared_balance(g,recipient))then raise exception 'El pago supera el saldo pendiente entre participantes.';end if;
   insert into public.shared_settlements(id,group_id,from_id,to_id,amount,date)values(i,g,u,recipient,amount,(p->>'date')::date);
  elsif act in ('confirm','cancel')then
   select * into settle from public.shared_settlements where id=i and group_id=g;
   if settle.id is null or settle.status<>'pending'or settle.version is distinct from(c->>'expected_version')::integer then raise exception 'conflicto: la liquidación cambió.';end if;
   if act='confirm' then
    if settle.to_id<>u then raise exception 'Solo quien recibe puede confirmar el pago.';end if;
    if settle.amount>least(-finance.shared_balance(g,settle.from_id),finance.shared_balance(g,settle.to_id))then raise exception 'El saldo cambió; cancela y registra otro importe.';end if;
   elsif u<>settle.from_id and u<>settle.to_id then raise exception 'No puedes cancelar este pago.';end if;
   update public.shared_settlements set status=case when act='confirm' then 'confirmed' else 'cancelled' end,version=version+1 where id=i;
  elsif act='archive' then
   if grp.owner_id<>u or exists(select 1 from public.shared_members where group_id=g and finance.shared_balance(g,user_id)<>0)or exists(select 1 from public.shared_settlements where group_id=g and status='pending')then raise exception 'Solo puedes archivar el grupo cuando todos sus saldos y pagos estén cerrados.';end if;
   update public.shared_groups set archived=true where id=g;
  end if;
 end if;
 result=coalesce(result,'{}'::jsonb)||jsonb_build_object('ok',true,'group_id',g);
 insert into finance.shared_receipts(user_id,command_hash,result)values(u,h,result);return result;
end $$;
create function public.shared_finance_command(command jsonb)returns jsonb language sql security invoker set search_path='' as $$select finance.shared_command(command);$$;
create function public.read_shared_finance()returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),'groups',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
 'members',(select coalesce(jsonb_agg(to_jsonb(m)order by m.user_id),'[]'::jsonb)from public.shared_members m where m.group_id=g.id),
 'expenses',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text)order by e.date desc,e.id),'[]'::jsonb)from public.shared_expenses e where e.group_id=g.id),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('amount',s.amount::text)order by s.created_at desc),'[]'::jsonb)from public.shared_settlements s where s.group_id=g.id)
 ) order by g.created_at desc)from public.shared_groups g),'[]'::jsonb));
$$;
revoke all on function finance.shared_member(uuid),finance.shared_balance(uuid,uuid),finance.shared_command(jsonb)from public,anon,authenticated;
grant execute on function finance.shared_member(uuid),finance.shared_command(jsonb)to authenticated;
revoke all on function public.shared_finance_command(jsonb),public.read_shared_finance()from public,anon;
grant execute on function public.shared_finance_command(jsonb),public.read_shared_finance()to authenticated;
