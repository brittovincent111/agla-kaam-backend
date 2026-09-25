import { Injectable, Logger } from '@nestjs/common';
import {
  LeadSearchParams,
  LeadSourceProvider,
  NormalizedBusinessLead,
  ProviderSearchResult,
} from './lead-source-provider.interface';

@Injectable()
export class ApprovedBusinessDirectoryProvider implements LeadSourceProvider {
  readonly providerId = 'approved_directory';
  readonly displayName = 'Approved Trade Directory';
  private readonly logger = new Logger(ApprovedBusinessDirectoryProvider.name);

  isConfigured(): boolean {
    return true; // Always available as default permitted source / simulation
  }

  async searchBusinesses(
    params: LeadSearchParams,
  ): Promise<ProviderSearchResult> {
    const { category, city, country, limit } = params;
    const requested = Math.min(20, Math.max(1, limit));

    // Simulated approved public directory results matching requested category and city
    const suffixes = [
      'Solutions',
      'Services & Repairs',
      'Technicians Hub',
      'Care Point',
      'Workshop & Spares',
      'Quick Fix Hub',
      'Cooling & Electricals',
      'Service Center',
      'Engineering Works',
    ];

    const areasInCity: Record<string, string[]> = {
      Kochi: ['Edappally', 'Kaloor', 'Palarivattom', 'Aluva', 'Ernakulam South'],
      Bengaluru: ['Indiranagar', 'Koramangala', 'Whitefield', 'HSR Layout', 'Jayanagar'],
      Mumbai: ['Andheri East', 'Bandra West', 'Thane', 'Borivali', 'Dadar'],
      Delhi: ['Connaught Place', 'Lajpat Nagar', 'Rohini', 'Dwarka', 'Janakpuri'],
      Dubai: ['Deira', 'Al Barsha', 'Business Bay', 'Karama', 'Jumeirah'],
    };

    const areas = areasInCity[city] || ['Main Market', 'Industrial Area', 'Downtown', 'Sector 4'];

    const items: NormalizedBusinessLead[] = [];

    const pageOffset = params.pageCursor ? parseInt(params.pageCursor, 10) : 0;
    const countToGenerate = Math.min(requested, 25);

    for (let i = 0; i < countToGenerate; i++) {
      const idx = pageOffset + i + 1;
      const area = areas[i % areas.length];
      const suffix = suffixes[i % suffixes.length];
      const businessName = `${city} ${category} ${suffix} #${idx}`;
      const random5Digits = 10000 + ((idx * 373) % 89999);
      const phone =
        country === 'India'
          ? `+91 984${(idx % 90) + 10} ${random5Digits}`
          : `+971 50 ${(idx % 900) + 100} ${random5Digits}`;

      items.push({
        businessName,
        category,
        categories: [category, 'Home & Business Services'],
        country,
        state: params.state,
        city,
        area,
        address: `Shop ${idx}, ${area}, ${city}, ${params.state || ''} ${country}`,
        phone,
        website: `https://${businessName.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`,
        source: this.providerId,
        sourcePlaceId: `dir_${city.toLowerCase()}_${category.toLowerCase().replace(/\s+/g, '_')}_${idx}`,
        sourceUrl: `https://directory.velocrew.in/listings/${city.toLowerCase()}/${idx}`,
        latitude: 9.9816 + (idx * 0.002),
        longitude: 76.2999 + (idx * 0.002),
        rating: Number((3.8 + ((idx % 12) * 0.1)).toFixed(1)),
        reviewCount: 5 + (idx * 7),
      });
    }

    const nextOffset = pageOffset + items.length;
    const hasMore = nextOffset < 60; // Max 60 mock records for demonstration

    return {
      items,
      nextPageCursor: hasMore ? nextOffset.toString() : undefined,
      hasMore,
      estimatedCostUsd: 0.0,
      rawRequestsCount: 1,
    };
  }
}
