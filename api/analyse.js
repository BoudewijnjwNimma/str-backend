const BASE = 'https://api.airroi.com';

function airroiHeaders(apiKey) {
  return { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
}

async function findMarket(city, apiKey) {
  const res = await fetch(
    `${BASE}/markets/find-by-name?name=${encodeURIComponent(city)}`,
    { headers: airroiHeaders(apiKey) }
  );
  if (!res.ok) throw new Error(`find-by-name ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getCalculator(market, apiKey) {
  const res = await fetch(
    `${BASE}/listings/calculator?locality=${encodeURIComponent(market.locality)}&region=${encodeURIComponent(market.region)}&country=${encodeURIComponent(market.country)}&bedrooms=2&guests=4&currency=usd`,
    { headers: airroiHeaders(apiKey) }
  );
  if (!res.ok) throw new Error(`calculator ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getMarketMetric(endpoint, market, apiKey) {
  const res = await fetch(`${BASE}${endpoint}`, {
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

  // "Calle Example 1, Málaga" → "Málaga"
  const parts = adres.split(',').map((p) => p.trim()).filter(Boolean);
  const city = parts[parts.length - 1];

  try {
    const market = await findMarket(city, apiKey);

    const [calculator, occupancy, adr] = await Promise.all([
      getCalculator(market, apiKey),
      getMarketMetric('/markets/occupancy', market, apiKey),
      getMarketMetric('/markets/avg_daily_rate', market, apiKey),
    ]);

    // Jaarhuur: calculator geeft projected_revenue of annual_revenue
    const verwacht_jaarhuur =
      calculator.projected_revenue ??
      calculator.annual_revenue ??
      calculator.revenue ??
      null;

    // Bezetting: ttm (trailing twelve months) of meest recente waarde
    const bezetting =
      occupancy.occupancy_rate ??
      occupancy.ttm ??
      occupancy.value ??
      null;

    // Gemiddelde dagprijs
    const gemiddelde_dagprijs =
      adr.avg_daily_rate ??
      adr.adr ??
      adr.ttm ??
      adr.value ??
      null;

    return res.status(200).json({
      adres,
      locatie: [market.locality, market.region, market.country].filter(Boolean).join(', '),
      verwacht_jaarhuur,
      bezetting,
      gemiddelde_dagprijs,
      bron: 'airroi',
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
