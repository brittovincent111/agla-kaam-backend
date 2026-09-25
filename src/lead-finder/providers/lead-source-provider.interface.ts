export interface LeadSearchParams {
  keyword?: string;
  category: string;
  country: string;
  state?: string;
  city: string;
  area?: string;
  limit: number;
  pageCursor?: string;
}

export interface NormalizedBusinessLead {
  businessName: string;
  displayName?: string;
  category: string;
  categories: string[];
  country: string;
  state?: string;
  city: string;
  area?: string;
  address?: string;
  phone?: string;
  phoneType?: 'mobile' | 'landline' | 'unknown';
  businessWhatsapp?: string;
  website?: string;
  email?: string;
  source: string;
  sourcePlaceId?: string;
  sourceUrl?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  reviewCount?: number;
  rawMetadata?: Record<string, any>;
}

export interface ProviderSearchResult {
  items: NormalizedBusinessLead[];
  nextPageCursor?: string;
  hasMore: boolean;
  estimatedCostUsd: number;
  rawRequestsCount: number;
}

export interface LeadSourceProvider {
  readonly providerId: string;
  readonly displayName: string;
  isConfigured(): boolean;
  searchBusinesses(params: LeadSearchParams): Promise<ProviderSearchResult>;
}
