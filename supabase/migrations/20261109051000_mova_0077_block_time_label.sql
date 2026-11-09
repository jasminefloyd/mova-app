-- P6 screens: Block time (board 08e) has a private label ("Lunch") next to the reason.
-- The reason keeps its text column; the label is new, empty by default, and only the artist sees it.
alter table public.mova_availability_blocks
  add column label text not null default '' check (char_length(label) <= 120);
