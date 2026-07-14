-- ============================================================
-- Migration 2: fix manager_transfers unique key (USER-APPROVED)
-- Add transfer_time so flip-flop transfers (same event+in+out swapped
-- multiple times at distinct timestamps) are preserved as separate rows.
-- No data loss: the 11,073 existing rows stay valid; adding a key column
-- keeps them distinct. Reversible (drop/re-add the constraint).
-- ============================================================
do $$
declare cname text;
begin
  for cname in select conname from pg_constraint
    where conrelid = 'fpl.manager_transfers'::regclass and contype = 'u'
  loop
    execute format('alter table fpl.manager_transfers drop constraint %I', cname);
  end loop;
end $$;

alter table fpl.manager_transfers
  add constraint manager_transfers_natural_key
  unique (season_id, manager_entry_id, gw_number,
          player_in_id, player_out_id, transfer_time);

-- verify
select conname from pg_constraint
 where conrelid = 'fpl.manager_transfers'::regclass and contype = 'u';
