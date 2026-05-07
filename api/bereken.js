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

async function getCalculator(adres, apiKey) {
  const params = new URLSearchParams({
    address: adres,
    bedrooms: '2',
    baths: '1',
    guests: '4',
    currency: 'native',
  });
  const res = await fetch(`${AIRROI}/calculator/estimate?${params}`, {
    headers: airroiHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`calculator ${res.status}: ${await res.text()}`);
  return res.json();
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

function extractCalcMetrics(data) {
  if (!data) return null;
  const revenue = data.annual_revenue ?? data.projected_revenue ?? data.ttm_revenue ?? data.revenue ?? null;
  const occupancy = data.occupancy_rate ?? data.occupancy ?? data.ttm_occupancy ?? null;
  const adr = data.avg_daily_rate ?? data.adr ?? data.ttm_avg_rate ?? null;
  if (revenue == null) return null;
  return { ttm_revenue: revenue, ttm_occupancy: occupancy, ttm_avg_rate: adr };
}

async function getAirroiMetrics(adres, location, apiKey) {
  // Stap 1: calculator ($0,20)
  const calcData = await getCalculator(adres, apiKey).catch(() => null);
  const calcMetrics = extractCalcMetrics(calcData);
  if (calcMetrics) {
    return { ...calcMetrics, bron_detail: 'calculator', aantal_comparables: 1 };
  }

  // Stap 2: comparables ($0,10 extra, alleen indien nodig)
  const comp = await getComparables(location, apiKey).catch(() => null);
  const listings = comp?.listings ?? [];
  if (listings.length > 0 && avgMetric(listings, 'ttm_revenue') != null) {
    return {
      ttm_revenue: avgMetric(listings, 'ttm_revenue'),
      ttm_occupancy: avgMetric(listings, 'ttm_occupancy'),
      ttm_avg_rate: avgMetric(listings, 'ttm_avg_rate'),
      bron_detail: 'comparables',
      aantal_comparables: listings.length,
    };
  }

  // Stap 3: search/market ($0,50 extra, alleen indien nodig)
  const market = await searchByMarket(location, apiKey);
  const marketListings = market?.results ?? [];
  return {
    ttm_revenue: avgMetric(marketListings, 'ttm_revenue'),
    ttm_occupancy: avgMetric(marketListings, 'ttm_occupancy'),
    ttm_avg_rate: avgMetric(marketListings, 'ttm_avg_rate'),
    bron_detail: 'search/market',
    aantal_comparables: marketListings.length,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    adres,
    vraagprijs,
    target_rendement = 6,
    kosten = {},
  } = req.body || {};

  if (!adres) return res.status(400).json({ error: 'Veld "adres" is verplicht' });
  if (!vraagprijs) return res.status(400).json({ error: 'Veld "vraagprijs" is verplicht' });

  const apiKey = process.env.AIRROI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AIRROI_API_KEY niet geconfigureerd' });

  const {
    airbnb_fee_pct = 3,
    management_fee_pct = 20,
    property_tax_pct = 1,
    verzekering = 0,
    onderhoud = 0,
    overig = 0,
  } = kosten;

  try {
    const location = await geocode(adres);
    if (!location.locality || !location.country) {
      return res.status(422).json({ error: 'Kon stad/land niet bepalen uit adres' });
    }

    const airroi = await getAirroiMetrics(adres, location, apiKey);
    const bruto = airroi.ttm_revenue;

    if (!bruto) {
      return res.status(502).json({ error: 'Geen AirROI data beschikbaar voor dit adres' });
    }

    const airbnb_fee      = bruto * (airbnb_fee_pct / 100);
    const management_fee  = bruto * (management_fee_pct / 100);
    const property_tax    = vraagprijs * (property_tax_pct / 100);
    const netto_jaarhuur  = bruto - airbnb_fee - management_fee - property_tax - verzekering - onderhoud - overig;

    // max_bod oplossing waarbij waardestijging = 2,5% van max_bod en kosten_koper = 11% van max_bod:
    // max_bod = (netto_jaarhuur / (r - 0.025)) / 1.11
    const r                   = target_rendement / 100;
    const max_bod             = (netto_jaarhuur / (r - 0.025)) / 1.11;
    const kosten_koper        = max_bod * 0.11;
    const waardestijging_jaar = max_bod * 0.025;
    const verschil            = vraagprijs - max_bod;
    const verschil_pct        = Math.round(Math.abs(verschil) / Math.max(vraagprijs, max_bod) * 100);
    const totaal_rendement_pct = Math.round(
      ((netto_jaarhuur + waardestijging_jaar) / (max_bod + kosten_koper)) * 10000
    ) / 100;

    const advies = verschil > 0
      ? `Vraagprijs ligt ${verschil_pct}% boven je maximale bod`
      : verschil < 0
      ? `Vraagprijs ligt ${verschil_pct}% onder je maximale bod`
      : 'Vraagprijs is gelijk aan je maximale bod';

    return res.status(200).json({
      max_bod: Math.round(max_bod),
      vraagprijs,
      verschil: Math.round(verschil),
      advies,
      netto_jaarhuur: Math.round(netto_jaarhuur),
      bruto_jaarhuur: Math.round(bruto),
      bezetting: airroi.ttm_occupancy != null ? Math.round(airroi.ttm_occupancy * 1000) / 1000 : null,
      gemiddelde_dagprijs: airroi.ttm_avg_rate != null ? Math.round(airroi.ttm_avg_rate) : null,
      waardestijging_jaar: Math.round(waardestijging_jaar),
      totaal_rendement_pct,
      aantal_comparables: airroi.aantal_comparables,
      bron_detail: airroi.bron_detail,
      locatie: [location.locality, location.region, location.country].filter(Boolean).join(', '),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
