alter table public.positions
  drop constraint if exists positions_level_check;

alter table public.positions
  add constraint positions_level_check check (level >= 1);
