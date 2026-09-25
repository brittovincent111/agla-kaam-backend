import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DeduplicationService } from './deduplication.service';
import { Lead } from './schemas/lead.schema';
import { NormalizedBusinessLead } from './providers/lead-source-provider.interface';

describe('DeduplicationService', () => {
  let service: DeduplicationService;
  let mockLeadModel: any;

  beforeEach(async () => {
    mockLeadModel = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeduplicationService,
        {
          provide: getModelToken(Lead.name),
          useValue: mockLeadModel,
        },
      ],
    }).compile();

    service = module.get<DeduplicationService>(DeduplicationService);
  });

  describe('normalizePhoneNumber', () => {
    it('normalizes 10-digit Indian phone number with +91', () => {
      expect(service.normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(service.normalizePhoneNumber('98765 43210')).toBe('+919876543210');
    });

    it('normalizes 11-digit number with leading 0 for India', () => {
      expect(service.normalizePhoneNumber('09876543210')).toBe('+919876543210');
    });

    it('normalizes 13-digit number with 091 prefix for India', () => {
      expect(service.normalizePhoneNumber('0919876543210')).toBe('+919876543210');
    });

    it('preserves existing +91 international prefix', () => {
      expect(service.normalizePhoneNumber('+91 98765 43210')).toBe('+919876543210');
    });

    it('handles international phone numbers', () => {
      expect(service.normalizePhoneNumber('+971 50 123 4567', 'UAE')).toBe('+971501234567');
      expect(service.normalizePhoneNumber('00971501234567', 'UAE')).toBe('+971501234567');
    });

    it('returns undefined for invalid or short phone numbers', () => {
      expect(service.normalizePhoneNumber('')).toBeUndefined();
      expect(service.normalizePhoneNumber('12345')).toBeUndefined();
      expect(service.normalizePhoneNumber(undefined)).toBeUndefined();
    });
  });

  describe('normalizeBusinessName', () => {
    it('strips common legal entities and stopwords', () => {
      expect(service.normalizeBusinessName('Apex Air Conditioning Services Pvt Ltd')).toBe(
        'apex air conditioning',
      );
      expect(service.normalizeBusinessName('QuickFix Appliances Repair & Service Co')).toBe(
        'quickfix appliances and',
      );
      expect(service.normalizeBusinessName('Smart RO Solutions & Water Care Center')).toBe(
        'smart ro and water',
      );
    });

    it('handles amp and special characters', () => {
      expect(service.normalizeBusinessName('A & B Electrical Works')).toBe('a and b electrical');
      expect(service.normalizeBusinessName('A&amp;B Plumbing Hub')).toBe('a and b plumbing');
    });
  });

  describe('normalizeCity', () => {
    it('aliases Cochin and Ernakulam to kochi', () => {
      expect(service.normalizeCity('Cochin')).toBe('kochi');
      expect(service.normalizeCity('Ernakulam')).toBe('kochi');
      expect(service.normalizeCity('Kochi')).toBe('kochi');
    });

    it('lowercases and trims other cities', () => {
      expect(service.normalizeCity('  Bangalore ')).toBe('bangalore');
      expect(service.normalizeCity('Mumbai')).toBe('mumbai');
    });
  });

  describe('findDuplicateAndEnrich', () => {
    const candidateLead: NormalizedBusinessLead = {
      businessName: 'Apex AC Services Pvt Ltd',
      category: 'ac_service',
      categories: ['ac_service'],
      city: 'Kochi',
      country: 'India',
      phone: '9876543210',
      source: 'google_places',
      sourcePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      website: 'https://apexac.in',
    };

    it('matches Priority 1 by source and sourcePlaceId', async () => {
      const mockDoc: any = {
        _id: 'mock-lead-id-1',
        businessName: 'Apex AC Services',
        phone: '9876543210',
        save: jest.fn().mockResolvedValue(true),
      };

      mockLeadModel.findOne.mockResolvedValueOnce(mockDoc);

      const result = await service.findDuplicateAndEnrich(candidateLead);

      expect(mockLeadModel.findOne).toHaveBeenCalledWith({
        source: 'google_places',
        sourcePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      });
      expect(result.isDuplicate).toBe(true);
      expect(result.matchReason).toBe('source_place_id');
      expect(result.leadId).toBe('mock-lead-id-1');
    });

    it('matches Priority 2 by normalized phone', async () => {
      const mockDoc: any = {
        _id: 'mock-lead-id-2',
        phone: '09876543210',
        save: jest.fn().mockResolvedValue(true),
      };

      // Priority 1 fails (no placeId match), Priority 2 succeeds
      mockLeadModel.findOne
        .mockResolvedValueOnce(null) // placeId
        .mockResolvedValueOnce(mockDoc); // phone

      const result = await service.findDuplicateAndEnrich(candidateLead);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchReason).toBe('phone_normalized');
      expect(result.leadId).toBe('mock-lead-id-2');
    });

    it('matches Priority 3 by normalized business name and city', async () => {
      const mockDoc: any = {
        _id: 'mock-lead-id-3',
        businessName: 'Apex AC',
        city: 'Cochin',
        save: jest.fn().mockResolvedValue(true),
      };

      mockLeadModel.findOne
        .mockResolvedValueOnce(null) // placeId
        .mockResolvedValueOnce(null) // phone
        .mockResolvedValueOnce(mockDoc); // name + city

      const result = await service.findDuplicateAndEnrich(candidateLead);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchReason).toBe('name_and_city');
      expect(result.leadId).toBe('mock-lead-id-3');
    });

    it('returns isDuplicate: false when no existing record matches', async () => {
      mockLeadModel.findOne.mockResolvedValue(null);

      const result = await service.findDuplicateAndEnrich(candidateLead);

      expect(result.isDuplicate).toBe(false);
      expect(result.matchReason).toBeUndefined();
    });
  });
});
