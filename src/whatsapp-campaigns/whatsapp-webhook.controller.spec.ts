import { ForbiddenException, Logger } from '@nestjs/common';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

// What Meta posts for a sent / delivered / read / failed message, and the
// lines that should appear in the pm2 log for each.

function build(signatureOk = true) {
  const cloud: any = { verifySignature: jest.fn().mockReturnValue(signatureOk) };
  const webhook: any = { handle: jest.fn().mockResolvedValue(undefined) };
  const controller = new WhatsappWebhookController({ get: jest.fn() } as any, cloud, webhook);
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { controller, webhook, log, warn };
}

const req = (body: unknown) =>
  ({ body, rawBody: Buffer.from(JSON.stringify(body)), headers: { 'x-hub-signature-256': 'sha256=00' } }) as any;

const statuses = (...list: unknown[]) => ({
  entry: [{ changes: [{ field: 'messages', value: { statuses: list } }] }],
});

afterEach(() => jest.restoreAllMocks());

describe('WhatsApp webhook logging', () => {
  it.each(['sent', 'delivered', 'read'])('logs a %s status with message id and recipient', async (status) => {
    const { controller, log } = build();
    await controller.receive(req(statuses({ id: 'wamid.ABC', status, timestamp: '1', recipient_id: '919562994337' })));
    expect(log).toHaveBeenCalledWith(`[WA status] ${status} id=wamid.ABC to=919562994337`);
  });

  it('logs a failed status with code, title, message and details', async () => {
    const { controller, log } = build();
    await controller.receive(
      req(
        statuses({
          id: 'wamid.F',
          status: 'failed',
          recipient_id: '919562994337',
          errors: [
            {
              code: 131049,
              title: 'Message not delivered',
              message: 'Message not delivered',
              error_data: { details: 'Not delivered to maintain healthy ecosystem engagement.' },
            },
          ],
        }),
      ),
    );
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('wamid.F'))!;
    expect(line).toContain('[WA status] failed id=wamid.F to=919562994337');
    expect(line).toContain('"code":131049');
    expect(line).toContain('"title":"Message not delivered"');
    expect(line).toContain('"details":"Not delivered to maintain healthy ecosystem engagement."');
  });

  it('logs incoming replies without their text', async () => {
    const { controller, log } = build();
    await controller.receive(
      req({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '919562994337', id: 'wamid.IN', type: 'button', context: { id: 'wamid.OUT' }, button: { text: 'Yes, show me' } },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(log).toHaveBeenCalledWith('[WA in] from=919562994337 type=button id=wamid.IN reply_to=wamid.OUT');
    expect(log.mock.calls.flat().join(' ')).not.toContain('Yes, show me');
  });

  it('still hands the payload to the handler and answers 200', async () => {
    const { controller, webhook } = build();
    const body = statuses({ id: 'wamid.X', status: 'sent', recipient_id: '91' });
    await expect(controller.receive(req(body))).resolves.toEqual({ received: true });
    expect(webhook.handle).toHaveBeenCalledWith(body);
  });

  it('answers 200 even when handling throws, so Meta does not retry for days', async () => {
    const { controller, webhook } = build();
    webhook.handle.mockRejectedValue(new Error('db down'));
    await expect(controller.receive(req(statuses()))).resolves.toEqual({ received: true });
  });

  it('rejects a bad signature, says why, and logs nothing from the payload', async () => {
    const { controller, log, warn } = build(false);
    await expect(
      controller.receive(req(statuses({ id: 'wamid.S', status: 'sent', recipient_id: '91' }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WHATSAPP_APP_SECRET'));
    expect(log).not.toHaveBeenCalled();
  });

  it('is not rate-limited', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', WhatsappWebhookController)).toBe(true);
  });
});
