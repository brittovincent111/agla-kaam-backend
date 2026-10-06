import { JwtService } from '@nestjs/jwt';
import { InvoiceShareService } from './invoice-share.service';

const SECRET = 'test_secret_at_least_32_characters_long';
const config = {
  get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined),
} as any;
const jwt = new JwtService({ secret: SECRET });
const share = new InvoiceShareService(jwt, config);

describe('invoice share links', () => {
  it('round-trips one invoice of one business', () => {
    const token = share.createToken('biz1', 'inv1');
    expect(share.verify(token)).toEqual({
      businessId: 'biz1',
      invoiceId: 'inv1',
    });
  });

  it('cannot be used as an API login token', () => {
    const token = share.createToken('biz1', 'inv1');
    expect(() => jwt.verify(token)).toThrow();
  });

  it('does not accept an API login token as a share link', () => {
    const login = jwt.sign({ sub: 'biz1', role: 'owner' });
    expect(share.verify(login)).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = share.createToken('biz1', 'inv1');
    expect(share.verify(token.slice(0, -2) + 'xx')).toBeNull();
  });

  it('builds the public URL from config, else the request host', () => {
    expect(share.url('t', 'https://api.example.com/')).toBe(
      'https://api.example.com/api/public/invoices/t',
    );
  });
});
