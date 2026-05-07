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

  const addr = results[0].address;
  return {
    country: addr.country ?? null,
    region: addr.state ?? addr.province ?? null,
    locality: addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? null,
    display: results[0].display_name ?? adres,
  };
}

async function postMarket(endpoint, market, apiKey) {
  const res = await fetch(`${AIRROI}${endpoint}`, {
    method: 'POST',
    headers: airroiHeaders(apiKey),
    body: JSON.stringify({
      market: {
        country: market.country,
        region: market.region,
        locality: market.locality,
      },
      currency: 'usd',
      num_months: 12,
    }),
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getCalculator(market, apiKey) {
  const params = new URLSearchParams({
    locality: market.locality,
    region: market.region,
    country: market.country,
    bedrooms: '2',
    guests: '4',
    currency: 'usd',
  });
  const res = await fetch(`${AIRROI}/listings/calculator?${params}`, {
    headers: airroiHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`calculator ${res.status}: ${await res.text()}`);
  return res.json();
}

function firstValue(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] != null) return obj[key];
  }
  return null;
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
    // Stap 1: adres → gestructureerde locatie via OpenStreetMap
    const market = await geocode(adres);

    if (!market.locality || !market.country) {
      return res.status(422).json({ error: 'Kon stad/land niet bepalen uit adres', locatie: market });
    }

    // Stap 2: AirROI calls parallel
    const [calculator, occupancy, adr] = await Promise.allSettled([
      getCalculator(market, apiKey),
      postMarket('/markets/occupancy', market, apiKey),
      postMarket('/markets/avg_daily_rate', market, apiKey),
    ]);

    // Resultaten uitlezen — gebruik .value als de call gelukt is
    const calc = calculator.status === 'fulfilled' ? calculator.value : null;
    const occ = occupancy.status === 'fulfilled' ? occupancy.value : null;
    const adrData = adr.status === 'fulfilled' ? adr.value : null;

    // Debug: stuur ruwe responses mee als iets null is
    const debug = {};
    if (!calc) debug.calculator_error = calculator.reason?.message;
    if (!occ) debug.occupancy_error = occupancy.reason?.message;
    if (!adrData) debug.adr_error = adr.reason?.message;

    return res.status(200).json({
      adres,
      locatie: [market.locality, market.region, market.country].filter(Boolean).join(', '),
      verwacht_jaarhuur: firstValue(calc, 'projected_revenue', 'annual_revenue', 'revenue', 'projected_annual_revenue'),
      bezetting: firstValue(occ, 'occupancy_rate', 'ttm', 'value', 'rate'),
      gemiddelde_dagprijs: firstValue(adrData, 'avg_daily_rate', 'adr', 'ttm', 'value'),
      bron: 'airroi',
      ...(Object.keys(debug).length ? { debug } : {}),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
