"""Render the guarded Rooted Beauty tenant reset as one PostgreSQL transaction."""

from pathlib import Path
import re

repo = Path(__file__).resolve().parents[2]
directory = repo / "scripts" / "demo"
seed = (repo / "supabase" / "seed.sql").read_text()
# Keep the production Auth identity intact. The normal developer seed also creates
# a placeholder user for fresh local databases, which is unnecessary for a reset.
seed, removed = re.subn(
    r"(?ms)^  insert into auth\.users .*?^  on conflict \(id\) do nothing;\n",
    "",
    seed,
    count=1,
)
if removed != 1 or "insert into auth.users" in seed.lower():
    raise SystemExit("The Auth portion of the canonical seed changed")

seed, replaced = re.subn(
    r"(?ms)^  select id into strict demo_user_id\n  from auth\.users\n.*?and deleted_at is null;",
    """  select m.user_id into strict demo_user_id
  from public.mova_artist_memberships m
  join auth.users u on u.id=m.user_id
  where m.artist_business_id=business_id and m.role='owner' and m.status='active'
    and u.email_confirmed_at is not null and u.deleted_at is null;""",
    seed,
    count=1,
)
seed, skipped = re.subn(
    r"(?ms)^  insert into public\.mova_artist_memberships .*?^  on conflict \(artist_business_id, user_id\) do nothing;\n",
    "",
    seed,
    count=1,
)
if replaced != 1 or skipped != 1:
    raise SystemExit("The owner portion of the canonical seed changed")

print("begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '35s';")
print((directory / "reset-rooted-beauty.sql").read_text())
print(seed)
print((directory / "polish-rooted-beauty.sql").read_text())
print("commit;")
