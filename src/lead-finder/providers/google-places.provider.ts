import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LeadSearchParams,
  LeadSourceProvider,
  NormalizedBusinessLead,
  ProviderSearchResult,
} from './lead-source-provider.interface';

@Injectable()
export class GooglePlacesProvider implements LeadSourceProvider {
  readonly providerId = 'google_places';
  readonly displayName = 'Google Places API';
  private readonly logger = new Logger(GooglePlacesProvider.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY');
  }

  private detectPhoneType(
    phone?: string,
    country = 'India',
  ): 'mobile' | 'landline' | 'unknown' {
    if (!phone) return 'unknown';
    const digits = phone.replace(/\D/g, '');
    if (!digits || digits.length < 7) return 'unknown';

    if (country.toLowerCase() === 'india' || digits.startsWith('91')) {
      const local =
        digits.startsWith('91') && digits.length >= 12
          ? digits.slice(-10)
          : digits.slice(-10);
      if (local.length === 10) {
        return /^[6-9]/.test(local) ? 'mobile' : 'landline';
      }
      return 'landline';
    }
    return 'unknown';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async searchBusinesses(
    params: LeadSearchParams,
  ): Promise<ProviderSearchResult> {
    if (!this.isConfigured()) {
      throw new Error(
        'Google Places API key is not configured in server environment (GOOGLE_PLACES_API_KEY).',
      );
    }

    const locationQuery = [
      params.keyword || params.category,
      params.area,
      params.city,
      params.state,
      params.country,
    ]
      .filter(Boolean)
      .join(', ');

    const pageSize = Math.min(20, Math.max(1, params.limit));

    const requestBody: Record<string, any> = {
      textQuery: locationQuery,
      pageSize,
      languageCode: 'en',
    };

    if (params.pageCursor) {
      requestBody.pageToken = params.pageCursor;
    }

    const fieldMask = [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.nationalPhoneNumber',
      'places.internationalPhoneNumber',
      'places.rating',
      'places.userRatingCount',
      'places.websiteUri',
      'places.googleMapsUri',
      'places.location',
      'places.types',
      'nextPageToken',
    ].join(',');

    const url = 'https://places.googleapis.com/v1/places:searchText';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey!,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.error(
        `Google Places API request failed [HTTP ${response.status}]: ${errText}`,
      );

      if (response.status === 429) {
        throw new Error('Google Places API quota/rate limit exceeded (HTTP 429)');
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Google Places API authentication or quota authorization failure (HTTP 401/403).',
        );
      }
      throw new Error(
        `Google Places API error (HTTP ${response.status}): ${errText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      places?: any[];
      nextPageToken?: string;
    };

    const rawPlaces = data.places || [];
    console.log('\n================== GOOGLE PLACES API RESPONSE ==================');
    console.log(`[GooglePlacesProvider] Query: "${locationQuery}" | Found: ${rawPlaces.length} places`);
    if (rawPlaces.length > 0) {
      console.log('[GooglePlacesProvider] Sample Raw Place Structure:');
      console.log(JSON.stringify(rawPlaces[0], null, 2));
    } else {
      console.log('[GooglePlacesProvider] Raw response body:', JSON.stringify(data, null, 2));
    }
    console.log('=================================================================\n');

    const items: NormalizedBusinessLead[] = rawPlaces.map((p) => {
      const name = p.displayName?.text || 'Unknown Business';
      const displayName = p.displayName?.text || name;
      const phone = p.internationalPhoneNumber || p.nationalPhoneNumber || undefined;
      const phoneType = this.detectPhoneType(phone, params.country);
      const categories: string[] = Array.isArray(p.types) ? p.types : [];

      return {
        businessName: name,
        displayName,
        category: params.category,
        categories,
        country: params.country,
        state: params.state,
        city: params.city,
        area: params.area,
        address: p.formattedAddress || undefined,
        phone,
        phoneType,
        website: p.websiteUri || undefined,
        source: this.providerId,
        sourcePlaceId: p.id || undefined,
        sourceUrl: p.googleMapsUri || undefined,
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        rating: typeof p.rating === 'number' ? p.rating : 0,
        reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
        rawMetadata: {
          types: p.types,
        },
      };
    });

    // Google Places TextSearch is ~$0.032 per request (Places Text Search SKU)
    const estimatedCostUsd = 0.032;

    return {
      items,
      nextPageCursor: data.nextPageToken || undefined,
      hasMore: Boolean(data.nextPageToken),
      estimatedCostUsd,
      rawRequestsCount: 1,
    };
  }
}
