import { describe, expect, it } from 'vitest';
import { resolveWorkspaces } from './stylist-workspace';

type Row = Record<string, unknown>;

// A minimal stand-in for the Supabase query builder: it answers each table from a fixture.
function fakeSupabase(tables: Record<string, Row[]>) {
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const api = {
      select() { return api; },
      eq(column: string, value: unknown) { rows = rows.filter((row) => row[column] === value); return api; },
      in(column: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[column])); return api; },
      limit(count: number) { rows = rows.slice(0, count); return api; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return api;
  };
  return { from: (table: string) => builder(table) } as unknown as Parameters<typeof resolveWorkspaces>[0];
}

const businessA = '11111111-1111-4111-8111-111111111111';
const businessB = '22222222-2222-4222-8222-222222222222';

describe('resolveWorkspaces', () => {
  it('sends a stylist with no business to onboarding', async () => {
    const supabase = fakeSupabase({ mova_artist_memberships: [] });
    expect(await resolveWorkspaces(supabase, 'user-1', '')).toEqual({ kind: 'none' });
  });

  it('opens the only business directly', async () => {
    const supabase = fakeSupabase({ mova_artist_memberships: [{ user_id: 'user-1', status: 'active', artist_business_id: businessA }] });
    expect(await resolveWorkspaces(supabase, 'user-1', '')).toEqual({ kind: 'one', businessId: businessA });
  });

  it('asks which business to open when there are several', async () => {
    const supabase = fakeSupabase({
      mova_artist_memberships: [
        { user_id: 'user-1', status: 'active', artist_business_id: businessA },
        { user_id: 'user-1', status: 'active', artist_business_id: businessB },
      ],
      mova_artist_profiles: [{ artist_business_id: businessA, display_name: 'Nia Studio' }],
    });
    expect(await resolveWorkspaces(supabase, 'user-1', '')).toEqual({
      kind: 'choose',
      choices: [{ id: businessA, label: 'Nia Studio' }, { id: businessB, label: businessB }],
    });
  });

  it('rejects a returnTo business the stylist does not belong to', async () => {
    const supabase = fakeSupabase({ mova_artist_memberships: [{ user_id: 'user-1', status: 'active', artist_business_id: businessA }] });
    await expect(resolveWorkspaces(supabase, 'user-1', `/${encodeURIComponent(businessB)}/settings`)).rejects.toThrow('WORKSPACE_ACCESS_DENIED');
  });
});
