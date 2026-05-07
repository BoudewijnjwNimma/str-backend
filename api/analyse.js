const AIRROI = 'https://api.airroi.com';

function airroiHeaders(apiKey) {
  return { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
}

async function geocode(adres) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adres)}&format=json&addressdetails=1&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'str-backend/1.0' } });
  if (!res.ok) throw new Error(`Geocoding mislukt: ${res.status}`);
  const results = await res.json();
  if (!results.length) throw new Error(`Adres niet gevonden: ${adres}`);

  const { address, lat, lon } = results[0];
  return {
    country: address.country ?? null,
    region: address.state ?? address.province ?? null,
    locality: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
    latitude: parseFloat(lat),
    longitude: parseFloat(lon),
  };
}

async function getComparables(location, apiKey) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    bedrooms: '2',
    baths: '1',
    guests: '4',
    currency: 'eur',
  });
  const res = await fetch(`${AIRROI}/listings/comparables?${params}`, {
    headers: airroiHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`comparables ${res.status}: ${await res.text()}`);
  return res.json();
}

async function searchByMarket(location, apiKey) {
  const res = await fetch(`${AIRROI}/listings/search/market`, {
    method: 'POST',
    headers: airroiHeaders(apiKey),
    body: JSON.stringify({
      market: {
        country: location.country,
        region: location.region,
        locality: location.locality,
      },
      pagination: { page_size: 20 },
      currency: 'eur',
    }),
  });
  if (!res.ok) throw new Error(`search/market ${res.status}: ${await res.text()}`);
  return res.json();
}

function avg(listings, field) {
  const values = listings
    .map((l) => l?.performance_metrics?.[field])
    .filter((v) => v != null && !isNaN(v));
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adres } = req.body || {};
  if (!adres) return res.status(400).json({ error: 'Veld "adres" is verplicht' });

  const apiKey = process.env.AIRROI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AIRROI_API_KEY niet geconfigureerd' });

  try {
    const location = await geocode(adres);

    if (!location.locality || !location.country) {
      return res.status(422).json({ error: 'Kon stad/land niet bepalen uit adres' });
    }

    const [compResult, marketResult] = await Promise.allSettled([
      getComparables(location, apiKey),
      searchByMarket(location, apiKey),
    ]);

    // Endpoint A: eerste comparable listing als primaire bron
    const comp = compResult.status === 'fulfilled' ? compResult.value : null;
    const firstListing = comp?.listings?.[0]?.performance_metrics ?? null;

    // Endpoint B: gemiddelde over alle market results
    const market = marketResult.status === 'fulfilled' ? marketResult.value : null;
    const marketListings = market?.results ?? [];

    // Primair: comparables (locatiespecifiek), fallback: marktgemiddelde
    const verwacht_jaarhuur =
      firstListing?.ttm_revenue ?? avg(marketListings, 'ttm_revenue');
    const bezetting =
      firstListing?.ttm_occupancy ?? avg(marketListings, 'ttm_occupancy');
    const gemiddelde_dagprijs =
      firstListing?.ttm_avg_rate ?? avg(marketListings, 'ttm_avg_rate');

    const response = {
      adres,
      locatie: [location.locality, location.region, location.country].filter(Boolean).join(', '),
      verwacht_jaarhuur: verwacht_jaarhuur != null ? Math.round(verwacht_jaarhuur) : null,
      bezetting,
      gemiddelde_dagprijs: gemiddelde_dagprijs != null ? Math.round(gemiddelde_dagprijs) : null,
      bron: 'airroi',
    };

    // Debug alleen meesturen als beide calls faalden
    if (compResult.status === 'rejected' && marketResult.status === 'rejected') {
      response.debug = {
        comparables_error: compResult.reason?.message,
        market_error: marketResult.reason?.message,
      };
    }

    return res.status(200).json(response);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
