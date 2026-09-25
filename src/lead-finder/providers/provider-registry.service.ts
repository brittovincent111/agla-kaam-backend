import { Injectable, Logger } from '@nestjs/common';
import { LeadSourceProvider } from './lead-source-provider.interface';
import { GooglePlacesProvider } from './google-places.provider';
import { ApprovedBusinessDirectoryProvider } from './approved-directory.provider';

@Injectable()
export class LeadProviderRegistry {
  private readonly logger = new Logger(LeadProviderRegistry.name);
  private readonly providers = new Map<string, LeadSourceProvider>();

  constructor(
    private readonly googlePlaces: GooglePlacesProvider,
    private readonly approvedDirectory: ApprovedBusinessDirectoryProvider,
  ) {
    this.register(this.googlePlaces);
    this.register(this.approvedDirectory);
  }

  register(provider: LeadSourceProvider): void {
    this.providers.set(provider.providerId, provider);
    this.logger.log(
      `Registered lead source provider: ${provider.providerId} (${provider.displayName}) - Configured: ${provider.isConfigured()}`,
    );
  }

  getProvider(providerId?: string): LeadSourceProvider {
    const id = providerId || 'google_places';
    const provider = this.providers.get(id);

    if (!provider) {
      throw new Error(`Unknown lead source provider: "${id}"`);
    }

    // If Google Places requested but not configured, throw a clear error
    if (id === 'google_places' && !provider.isConfigured()) {
      throw new Error(
        'Google Places API key is not configured in backend/.env (GOOGLE_PLACES_API_KEY).',
      );
    }

    return provider;
  }

  listProviders(): { id: string; name: string; isConfigured: boolean }[] {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.providerId,
      name: p.displayName,
      isConfigured: p.isConfigured(),
    }));
  }
}
