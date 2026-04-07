// B11: Outscraper Google Maps Search Service
// IMPORTANT: No module-scope client init — Hard Lesson #34

export interface OutscraperBusiness {
  name?: string;
  type?: string;
  subtypes?: string[];
  phone?: string;
  site?: string;
  full_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
  rating?: number;
  reviews?: number;
  place_id?: string;
  emails_and_contacts?: {
    emails?: string[];
    phones?: string[];
  };
}

export async function searchBusinesses(
  apiKey: string,
  query: string,
  location: string,
  limit: number
): Promise<{
  results: Partial<import('@/lib/supabase/types').LeadContact>[];
  raw_count: number;
}> {
  const searchQuery = `${query}, ${location}`;
  const url = `https://api.app.outscraper.com/maps/search-v3?query=${encodeURIComponent(searchQuery)}&limit=${limit}&async=false`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outscraper API error (${response.status}): ${text}`);
  }

  const json = await response.json();

  // Outscraper returns array of arrays — outer = queries, inner = results per query
  const rawResults: OutscraperBusiness[] = json?.data?.[0] || [];

  const contacts = rawResults.map((r) => ({
    business_name: r.name || null,
    business_type: r.type || r.subtypes?.[0] || null,
    email: r.emails_and_contacts?.emails?.[0] || null,
    phone: r.phone || null,
    website: r.site || null,
    full_address: r.full_address || null,
    city: r.city || null,
    state: r.state || null,
    zip: r.postal_code || null,
    country: r.country_code || 'US',
    google_rating: r.rating ?? null,
    google_reviews_count: r.reviews ?? null,
    google_place_id: r.place_id || null,
    scrape_source: 'outscraper' as const,
    scraped_at: new Date().toISOString(),
    scrape_query: searchQuery,
    email_status: 'pending' as const,
  }));

  return { results: contacts, raw_count: rawResults.length };
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `https://api.app.outscraper.com/maps/search-v3?query=${encodeURIComponent('test')}&limit=1&async=false`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
