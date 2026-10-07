import { AuthService } from './auth.service';

// A team member signs in with the role they hold: manager or technician.
function make() {
  const service: any = Object.create(AuthService.prototype);
  service.jwtService = { signAsync: jest.fn(async () => 'tok') };
  service.businessesService = { findById: jest.fn(async () => ({ id: 'b1' })) };
  return service;
}
const member = (role?: string) => ({
  id: 'tm-1',
  email: 'm@example.com',
  active: true,
  businessId: 'b1',
  role,
});

describe('team member sign-in role', () => {
  it('issues a manager token to a manager, keeping teamMemberId', async () => {
    const service = make();
    const session = await service.issueTechnicianToken(member('manager'));
    expect(session.role).toBe('manager');
    expect(service.jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager', teamMemberId: 'tm-1', sub: 'b1' }),
    );
  });

  it('issues a technician token to anyone else', async () => {
    for (const role of ['technician', undefined, 'something-old']) {
      const service = make();
      const session = await service.issueTechnicianToken(member(role));
      expect(session.role).toBe('technician');
    }
  });
});

// App 1.0.0 shows the owner's screens to any role but technician, so a
// manager on it keeps getting a technician session until they update.
describe('manager session by app version', () => {
  const managerSession = { accessToken: 'mgr', role: 'manager', business: { id: 'b1' } };
  function withJwt() {
    const service: any = Object.create(AuthService.prototype);
    service.jwtService = {
      verifyAsync: jest.fn(async () => ({ sub: 'b1', role: 'manager', teamMemberId: 'tm-1', iat: 1, exp: 2 })),
      signAsync: jest.fn(async () => 'tech'),
    };
    return service;
  }

  it.each([undefined, '1.0.0', '0.9.5'])('app %s gets a technician session', async (version) => {
    const service = withJwt();
    const session = await service.sessionForApp(managerSession, version);
    expect(session).toMatchObject({ role: 'technician', accessToken: 'tech' });
    expect(service.jwtService.signAsync).toHaveBeenCalledWith({ sub: 'b1', role: 'technician', teamMemberId: 'tm-1' });
  });

  it.each(['1.0.1', '1.1.0'])('app %s keeps the manager session', async (version) => {
    const service = withJwt();
    expect(await service.sessionForApp(managerSession, version)).toBe(managerSession);
  });

  it('leaves owners and technicians alone whatever the version', async () => {
    const service = withJwt();
    const owner = { accessToken: 'o', role: 'owner' };
    expect(await service.sessionForApp(owner, undefined)).toBe(owner);
    expect(service.jwtService.signAsync).not.toHaveBeenCalled();
  });
});
