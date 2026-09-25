import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { NormalizedBusinessLead } from './providers/lead-source-provider.interface';

export interface DeduplicationResult {
  isDuplicate: boolean;
  leadId?: string;
  leadDoc?: LeadDocument;
  matchReason?: 'source_place_id' | 'phone_normalized' | 'name_and_city';
  enriched?: boolean;
}

@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
  ) {}

  /**
   * Normalizes a phone number to standard E.164.
   * Recognizes Indian numbers (+91, 0, 091, bare 10-digits) and international formats.
   */
  normalizePhoneNumber(rawPhone?: string, defaultCountry = 'India'): string | undefined {
    if (!rawPhone) return undefined;

    const trimmed = rawPhone.trim();
    if (!trimmed) return undefined;

    // Strip all non-digit characters except leading plus
    let hasPlus = trimmed.startsWith('+');
    let digits = trimmed.replace(/\D/g, '');

    if (!digits || digits.length < 7) return undefined;

    // Handle common Indian phone prefixes
    if (defaultCountry.toLowerCase() === 'india' || digits.startsWith('91')) {
      if (digits.startsWith('091') && digits.length === 13) {
        digits = digits.slice(1); // Remove leading 0 -> 91...
      } else if (digits.startsWith('91') && digits.length === 12) {
        // already has 91
      } else if (digits.startsWith('0') && digits.length === 11) {
        digits = '91' + digits.slice(1); // 09876543210 -> 919876543210
      } else if (digits.length === 10) {
        digits = '91' + digits; // 9876543210 -> 919876543210
      }
      return `+${digits}`;
    }

    // Gulf numbers (UAE +971, Saudi +966, etc.)
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
      hasPlus = true;
    }

    if (hasPlus) {
      return `+${digits}`;
    }

    // Default fallback
    return `+${digits}`;
  }

  /**
   * Normalizes a business name by removing legal entity suffixes and generic stopwords.
   */
  normalizeBusinessName(name: string): string {
    if (!name) return '';

    return name
      .toLowerCase()
      .replace(/&(amp;)?/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ') // Strip punctuation
      .replace(
        /\b(pvt|ltd|private|limited|llp|inc|co|company|enterprises|enterprise|services|service|repairs|repair|solutions|technicians|technician|works|workshop|hub|center|centre|care|point)\b/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalizes city names (e.g. 'Kochi', 'Cochin', 'Ernakulam' or simple lowercase).
   */
  normalizeCity(city: string): string {
    if (!city) return '';
    const clean = city.toLowerCase().trim();
    if (clean === 'cochin' || clean === 'ernakulam') return 'kochi';
    return clean;
  }

  /**
   * Checks if candidate lead already exists using Priority 1, 2, 3 deduplication.
   * If existing lead is found, optionally enriches missing data.
   */
  async findDuplicateAndEnrich(
    candidate: NormalizedBusinessLead,
    jobId?: string,
  ): Promise<DeduplicationResult> {
    const phoneNorm = this.normalizePhoneNumber(candidate.phone, candidate.country);
    const nameNorm = this.normalizeBusinessName(candidate.businessName);
    const cityNorm = this.normalizeCity(candidate.city);

    // Priority 1: source + sourcePlaceId (exact place match)
    if (candidate.sourcePlaceId) {
      const match = await this.leadModel.findOne({
        source: candidate.source,
        sourcePlaceId: candidate.sourcePlaceId,
      });

      if (match) {
        const enriched = await this.enrichExistingLead(match, candidate);
        return {
          isDuplicate: true,
          leadId: match._id.toString(),
          leadDoc: match,
          matchReason: 'source_place_id',
          enriched,
        };
      }
    }

    // Priority 2: Normalized Phone Number (excluding common toll-free / call centers)
    if (phoneNorm && !phoneNorm.includes('1800') && !phoneNorm.includes('1860')) {
      const match = await this.leadModel.findOne({ phoneNormalized: phoneNorm });
      if (match) {
        const enriched = await this.enrichExistingLead(match, candidate);
        return {
          isDuplicate: true,
          leadId: match._id.toString(),
          leadDoc: match,
          matchReason: 'phone_normalized',
          enriched,
        };
      }
    }

    // Priority 3: Normalized Business Name + City
    if (nameNorm.length >= 3 && cityNorm.length >= 2) {
      const match = await this.leadModel.findOne({
        businessNameNormalized: nameNorm,
        cityNormalized: cityNorm,
      });

      if (match) {
        const enriched = await this.enrichExistingLead(match, candidate);
        return {
          isDuplicate: true,
          leadId: match._id.toString(),
          leadDoc: match,
          matchReason: 'name_and_city',
          enriched,
        };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Enriches existing lead with any newly available data without overwriting user notes/status.
   */
  private async enrichExistingLead(
    existing: LeadDocument,
    incoming: NormalizedBusinessLead,
  ): Promise<boolean> {
    let updated = false;

    if (!existing.displayName && incoming.displayName) {
      existing.displayName = incoming.displayName;
      updated = true;
    }
    if (!existing.website && incoming.website) {
      existing.website = incoming.website;
      updated = true;
    }
    if (!existing.phone && incoming.phone) {
      existing.phone = incoming.phone;
      existing.phoneNormalized = this.normalizePhoneNumber(incoming.phone, incoming.country);
      (existing as any).phoneType = incoming.phoneType;
      updated = true;
    }
    if (!existing.sourceUrl && incoming.sourceUrl) {
      existing.sourceUrl = incoming.sourceUrl;
      updated = true;
    }
    if (!existing.latitude && incoming.latitude) {
      existing.latitude = incoming.latitude;
      existing.longitude = incoming.longitude;
      updated = true;
    }
    if ((!existing.rating || existing.rating === 0) && incoming.rating) {
      existing.rating = incoming.rating;
      existing.reviewCount = incoming.reviewCount;
      updated = true;
    }

    // Update last collected timestamp
    existing.lastCollectedAt = new Date();
    await existing.save();

    return updated;
  }
}
