import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AppleVerificationService } from './apple-verification.service';

describe('AppleVerificationService', () => {
  let service: AppleVerificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleVerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'APPLE_IAP_KEY_ID') return 'TESTKEYID';
              if (key === 'APPLE_IAP_ISSUER_ID') return 'test-issuer-id';
              if (key === 'APPLE_IAP_PRIVATE_KEY')
                return '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQguvV684j7PfL1fmQ9\nlyX86h0dzx0nWAXoKzYyUVDuwwegCgYIKoZIzj0DAQehRANCAAQvIgNTLmvKdDkt\nO0pBP1ZTDNeBIZyBOz/VZwBzlh+9VqP/g7vUpQBI3b5bJGFzEZyodfzz/lv31APn\nud035FeG\n-----END PRIVATE KEY-----';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AppleVerificationService>(AppleVerificationService);
  });

  describe('extractTransactionId', () => {
    it('should extract transactionId from a valid raw transaction ID string', async () => {
      const result = await service.extractTransactionId('2000000987654321');
      expect(result).toBe('2000000987654321');
    });

    it('should throw BadRequestException for invalid empty token', async () => {
      await expect(service.extractTransactionId('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
