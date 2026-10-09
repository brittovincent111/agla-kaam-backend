import {
  buildCollectionPush,
  buildNewJobPush,
  jobDayLabel,
} from './job-push.service';
import { buildMorningPush } from '../reminders/reminders.service';
import { ownerPushTokens } from '../common/push/owner-tokens';

const IST = 'Asia/Kolkata';
// 9 Oct 2026, 10:00 in India.
const now = new Date('2026-10-09T04:30:00Z');

describe('jobDayLabel', () => {
  it('reads a date saved as UTC midnight as that day', () => {
    expect(jobDayLabel(new Date('2026-10-09T00:00:00Z'), IST, now)).toBe('Today');
    expect(jobDayLabel(new Date('2026-10-10T00:00:00Z'), IST, now)).toBe('Tomorrow');
  });

  it('reads a date saved as local midnight as that day', () => {
    // 10 Oct 00:00 in India.
    expect(jobDayLabel(new Date('2026-10-09T18:30:00Z'), IST, now)).toBe('Tomorrow');
  });

  it('names a later day', () => {
    expect(jobDayLabel(new Date('2026-10-12T00:00:00Z'), IST, now)).toMatch(/12 Oct/);
  });

  it('keeps a UTC-midnight day in a zone behind UTC', () => {
    const ny = new Date('2026-10-09T14:00:00Z'); // 10:00 in New York
    expect(jobDayLabel(new Date('2026-10-09T00:00:00Z'), 'America/New_York', ny)).toBe('Today');
  });
});

describe('buildNewJobPush', () => {
  it('names the customer, the work and when, and opens the job', () => {
    const push = buildNewJobPush(
      [
        {
          id: 's1',
          customerName: 'Anil Kumar',
          serviceType: 'AC service',
          serviceDate: new Date('2026-10-10T00:00:00Z'),
          visitSlot: '14:30',
        },
      ],
      IST,
      now,
    );
    expect(push.title).toBe('New job for you');
    expect(push.body).toBe('Anil Kumar · AC service · Tomorrow · 2:30 PM');
    expect(push.data).toEqual({ screen: 'ServiceCard', serviceId: 's1' });
  });

  it('sums up several jobs', () => {
    const job = (id: string, name: string) => ({
      id,
      customerName: name,
      serviceType: 'RO service',
      serviceDate: new Date('2026-10-09T00:00:00Z'),
    });
    const push = buildNewJobPush(
      [job('a', 'Anil'), job('b', 'Bina'), job('c', 'Chitra'), job('d', 'Dev')],
      IST,
      now,
    );
    expect(push.title).toBe('4 new jobs for you');
    expect(push.body).toBe('Anil, Bina and 2 more. Tap to see your jobs.');
    expect(push.data).toEqual({ screen: 'Home' });
  });
});

describe('buildCollectionPush', () => {
  it('says who took cash, how much and from whom', () => {
    const push = buildCollectionPush({
      serviceId: 's1',
      amount: 1200,
      method: 'cash',
      currency: 'INR',
      collectorName: 'Ravi',
      customerName: 'Anil Kumar',
      serviceType: 'AC service',
    });
    expect(push.title).toBe('₹1,200 cash collected by Ravi');
    expect(push.body).toBe('Cash · Anil Kumar · AC service');
    expect(push.data).toEqual({ screen: 'ServiceCard', serviceId: 's1' });
  });

  it('words a UPI payment as paid', () => {
    const push = buildCollectionPush({ serviceId: 's1', amount: 450.5, method: 'upi' });
    expect(push.title).toBe('₹450.50 paid by UPI');
  });
});

describe('buildMorningPush', () => {
  it('stays quiet with nothing due or overdue', () => {
    expect(buildMorningPush(0, 0)).toBeNull();
  });

  it('gives both counts and opens overdue first', () => {
    const push = buildMorningPush(2, 6)!;
    expect(push.title).toBe('2 services due today · 6 overdue');
    expect(push.data).toEqual({ screen: 'Services', filter: 'overdue' });
  });

  it('still sends when only overdue work is left', () => {
    const push = buildMorningPush(0, 1)!;
    expect(push.title).toBe('1 service overdue');
    expect(push.data).toEqual({ screen: 'Services', filter: 'overdue' });
  });

  it('opens today when nothing is overdue', () => {
    expect(buildMorningPush(3, 0)!.data).toEqual({ screen: 'Services', filter: 'today' });
  });
});

describe('ownerPushTokens', () => {
  it('joins the list and the legacy single token without repeats', () => {
    expect(ownerPushTokens({ pushToken: 'b', pushTokens: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(ownerPushTokens({ pushToken: 'x' })).toEqual(['x']);
    expect(ownerPushTokens({})).toEqual([]);
  });
});
