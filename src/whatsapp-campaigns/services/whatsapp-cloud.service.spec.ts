import { ConfigService } from '@nestjs/config';
import { WhatsappCloudService } from './whatsapp-cloud.service';

describe('WhatsApp account messaging allowance', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function service(wabaId: string | undefined = 'account-id') {
    return new WhatsappCloudService(new ConfigService({
      WHATSAPP_ACCESS_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      WHATSAPP_WABA_ID: wabaId,
    }));
  }

  function response(value: object) {
    return { ok: true, text: async () => JSON.stringify(value) };
  }

  it('recognises the current 2K portfolio allowance when the obsolete phone tier is absent', async () => {
    fetchMock.mockResolvedValueOnce(response({ quality_rating: 'GREEN' }));
    fetchMock.mockResolvedValueOnce(response({ whatsapp_business_manager_messaging_limit: 'TIER_2K' }));

    await expect(service().phoneHealth()).resolves.toEqual({
      qualityRating: 'GREEN', messagingLimitTier: 'TIER_2K', dailyCap: 2000,
    });
    expect(fetchMock.mock.calls[1][0]).toContain('/account-id?fields=whatsapp_business_manager_messaging_limit');
  });

  it('keeps a 250-person portfolio at 250', async () => {
    fetchMock.mockResolvedValueOnce(response({ quality_rating: 'YELLOW' }));
    fetchMock.mockResolvedValueOnce(response({ whatsapp_business_manager_messaging_limit: 'TIER_250' }));
    await expect(service().phoneHealth()).resolves.toMatchObject({ qualityRating: 'YELLOW', dailyCap: 250 });
  });

  it('does not invent an allowance for an unknown tier', async () => {
    fetchMock.mockResolvedValueOnce(response({ quality_rating: 'GREEN' }));
    fetchMock.mockResolvedValueOnce(response({ whatsapp_business_manager_messaging_limit: 'UNTIERED' }));
    expect((await service().phoneHealth()).dailyCap).toBeUndefined();
  });
});
