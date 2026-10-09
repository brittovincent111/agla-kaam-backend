import { ForbiddenException } from '@nestjs/common';
import { TeamMembersService } from './team-members.service';

// The seat rule only: what a business may have, and who keeps a seat.
function make(opts: { tier: string | null; team: boolean; granted?: number; active: string[] }) {
  const members = opts.active.map((id, i) => ({ _id: { toString: () => id }, createdAt: new Date(2026, 0, i + 1) }));
  const teamMemberModel: any = {
    countDocuments: () => ({ exec: async () => members.length }),
    find: () => {
      let n = members.length;
      const q: any = {
        sort: () => q,
        limit: (k: number) => ((n = k), q),
        select: () => q,
        exec: async () => members.slice(0, n),
      };
      return q;
    },
  };
  const subs: any = { getActiveTier: async () => opts.tier, hasActiveTeamAddon: async () => opts.team };
  const businesses: any = { findById: async () => ({ teamSeatLimit: opts.granted }) };
  return new TeamMembersService(teamMemberModel, {} as any, {} as any, businesses, subs);
}

describe('technician seats', () => {
  it('without Team: one free test seat', async () => {
    expect(await make({ tier: null, team: false, active: [] }).seatInfo('b')).toMatchObject({ limit: 1, teamEnabled: false });
  });

  it('Combo + Team: 4 seats — the owner and 3 staff', async () => {
    expect(await make({ tier: 'combo', team: true, active: ['a'] }).seatInfo('b')).toMatchObject({ limit: 3, seats: 4, used: 1, teamEnabled: true });
  });

  it('Combo + Team with seats granted by us: the higher of the two', async () => {
    // Granted seats count the owner too: 12 seats is 11 staff.
    expect((await make({ tier: 'combo', team: true, granted: 12, active: [] }).seatInfo('b')).limit).toBe(11);
    expect((await make({ tier: 'combo', team: true, granted: 3, active: [] }).seatInfo('b')).limit).toBe(3);
  });

  it('granted seats do nothing once Team has lapsed', async () => {
    expect((await make({ tier: 'combo', team: false, granted: 12, active: [] }).seatInfo('b')).limit).toBe(1);
  });

  it('a full paid team is told the seats are full, with no outside offer', async () => {
    // The owner plus 3 staff fill the 4 seats.
    const s = make({ tier: 'combo', team: true, active: ['1', '2', '3'] });
    await expect((s as any).assertSeatAvailable('b')).rejects.toThrow(/All 4 seats are in use \(you and 3 staff\)/);
  });

  it('a full free plan is told about Combo + Team', async () => {
    const s = make({ tier: null, team: false, active: ['1'] });
    await expect((s as any).assertSeatAvailable('b')).rejects.toBeInstanceOf(ForbiddenException);
    await expect((s as any).assertSeatAvailable('b')).rejects.toThrow(/Upgrade to Combo \+ Team/);
  });

  it('a fourth staff member is past the 4 seats (owner + 3) and is the one locked out', async () => {
    const s = make({ tier: 'combo', team: true, active: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(await s.holdsSeat('b', '3')).toBe(true);
    expect(await s.holdsSeat('b', '4')).toBe(false);
  });
});
