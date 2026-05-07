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

  // Extract city from address: "Calle X 1, Málaga" → "Málaga"
  const parts = adres.split(',').map((p) => p.trim()).filter(Boolean);
  const city = parts[parts.length - 1];

  try {
    // Stap 1: Zoek de markt op naam om country/region/locality te krijgen
    const findRes = await fetch(
      `https://api.airroi.com/markets/find-by-name?name=${encodeURIComponent(city)}`,
      { headers: { 'X-API-KEY': apiKey } }
    );

    if (!findRes.ok) {
      const text = await findRes.text();
      return res.status(502).json({ error: 'AirROI markt niet gevonden', detail: text });
    }

    const market = await findRes.json();

    // Stap 2: Haal alle metrics op voor deze markt
    const metricsRes = await fetch('https://api.airroi.com/markets/all-metrics', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
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

    if (!metricsRes.ok) {
      const text = await metricsRes.text();
      return res.status(502).json({ error: 'AirROI metrics ophalen mislukt', detail: text });
    }

    const metrics = await metricsRes.json();

    // Jaarhuur = maandelijkse revenue * 12 (TTM = trailing twelve months)
    const maandRevenue = metrics.revenue?.ttm ?? null;
    const verwacht_jaarhuur = maandRevenue !== null ? Math.round(maandRevenue * 12) : null;

    return res.status(200).json({
      adres,
      locatie: [market.locality, market.region, market.country].filter(Boolean).join(', '),
      verwacht_jaarhuur,
      bezetting: metrics.occupancy?.ttm ?? null,
      gemiddelde_dagprijs: metrics.adr?.ttm ?? null,
      bron: 'airroi',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Onverwachte fout', detail: err.message });
  }
}
