const AIRROI = 'https://api.airroi.com';

function airroiHeaders(apiKey) {
  return { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
}

async function geocode(adres) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adres)}&format=json&addressdetails=1&limit=1`,
    { headers: { 'User-Agent': 'str-backend/1.0' } }
  );
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
    currency: 'native',
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
      market: { country: location.country, region: location.region, locality: location.locality },
      pagination: { pageSize: 10 },
      currency: 'native',
    }),
  });
  if (!res.ok) throw new Error(`search/market ${res.status}: ${await res.text()}`);
  return res.json();
}

function avgMetric(listings, field) {
  const vals = listings.map((l) => l?.performance_metrics?.[field]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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

    // Primair: comparables op coördinaten (1 call)
    let metrics = null;
    let bron_detail = 'comparables';

    const comp = await getComparables(location, apiKey);
    const first = comp?.listings?.[0]?.performance_metrics ?? null;

    if (first?.ttm_revenue) {
      metrics = first;
    } else {
      // Fallback: marktgemiddelde (2e call, alleen indien nodig)
      bron_detail = 'search/market';
      const market = await searchByMarket(location, apiKey);
      const listings = market?.results ?? [];
      metrics = {
        ttm_revenue: avgMetric(listings, 'ttm_revenue'),
        ttm_occupancy: avgMetric(listings, 'ttm_occupancy'),
        ttm_avg_rate: avgMetric(listings, 'ttm_avg_rate'),
      };
    }

    return res.status(200).json({
      adres,
      locatie: [location.locality, location.region, location.country].filter(Boolean).join(', '),
      verwacht_jaarhuur: metrics.ttm_revenue != null ? Math.round(metrics.ttm_revenue) : null,
      bezetting: metrics.ttm_occupancy != null ? Math.round(metrics.ttm_occupancy * 1000) / 1000 : null,
      gemiddelde_dagprijs: metrics.ttm_avg_rate != null ? Math.round(metrics.ttm_avg_rate) : null,
      bron: 'airroi',
      bron_detail,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
