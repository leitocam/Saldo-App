-- Cover reference lookups and FK checks without changing financial data.
create index entries_movement_idx on public.account_entries(movement_id);
create index entries_account_idx on public.account_entries(account_id);
create index movements_account_idx on public.movements(account_id);
create index movements_destination_idx on public.movements(destination_id);
create index movements_category_idx on public.movements(category_id);
create index budgets_category_idx on public.budgets(category_id);
create index recurring_category_idx on public.recurring(category_id);
create index recurring_account_idx on public.recurring(account_id);
create index allocations_goal_idx on public.goal_allocations(goal_id);
create index consumptions_lot_idx on public.usdt_consumptions(lot_id);
create index consumptions_movement_idx on public.usdt_consumptions(movement_id);
