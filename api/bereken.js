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

async function getAirroiData(location, apiKey) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    bedrooms: '2',
    baths: '1',
    guests: '4',
    currency: 'native',
  });

  const [compResult, marketResult] = await Promise.allSettled([
    fetch(`${AIRROI}/listings/comparables?${params}`, { headers: airroiHeaders(apiKey) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`comparables ${r.status}`)))),
    fetch(`${AIRROI}/listings/search/market`, {
      method: 'POST',
      headers: airroiHeaders(apiKey),
      body: JSON.stringify({
        market: { country: location.country, region: location.region, locality: location.locality },
        pagination: { pageSize: 10 },
        currency: 'native',
      }),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`search/market ${r.status}`)))),
  ]);

  const firstMetrics = compResult.status === 'fulfilled'
    ? compResult.value?.listings?.[0]?.performance_metrics ?? null
    : null;

  const marketListings = marketResult.status === 'fulfilled'
    ? marketResult.value?.results ?? []
    : [];

  function avgMetric(field) {
    const vals = marketListings.map((l) => l?.performance_metrics?.[field]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  return {
    bruto_jaarhuur: firstMetrics?.ttm_revenue ?? avgMetric('ttm_revenue'),
    bezetting: firstMetrics?.ttm_occupancy ?? avgMetric('ttm_occupancy'),
    gemiddelde_dagprijs: firstMetrics?.ttm_avg_rate ?? avgMetric('ttm_avg_rate'),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
    slaapkamers = 2,
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

    const airroi = await getAirroiData(location, apiKey);
    const bruto = airroi.bruto_jaarhuur;

    if (!bruto) {
      return res.status(502).json({ error: 'Geen AirROI data beschikbaar voor dit adres' });
    }

    // Kosten berekening
    const airbnb_fee    = bruto * (airbnb_fee_pct / 100);
    const management_fee = bruto * (management_fee_pct / 100);
    const property_tax  = vraagprijs * (property_tax_pct / 100);
    const totale_kosten = airbnb_fee + management_fee + property_tax + verzekering + onderhoud + overig;

    const netto_jaarhuur = bruto - totale_kosten;

    // Kosten koper: 11% van vraagprijs (eenmalig)
    const kosten_koper = vraagprijs * 0.11;

    // Waardestijging: 2,5% per jaar van vraagprijs
    const waardestijging_jaar = vraagprijs * 0.025;

    // Maximaal bod: netto / rendement - kosten koper
    const max_bod = (netto_jaarhuur / (target_rendement / 100)) - kosten_koper;

    // Verschil vraagprijs vs max bod
    const verschil = vraagprijs - max_bod;
    const verschil_pct = Math.round(Math.abs(verschil) / Math.max(vraagprijs, max_bod) * 100);

    let advies;
    if (verschil > 0) {
      advies = `Vraagprijs ligt ${verschil_pct}% boven je maximale bod`;
    } else if (verschil < 0) {
      advies = `Vraagprijs ligt ${verschil_pct}% onder je maximale bod`;
    } else {
      advies = 'Vraagprijs is gelijk aan je maximale bod';
    }

    // Totaalrendement: (netto + waardestijging) / (vraagprijs + kosten koper) * 100
    const totaal_rendement_pct = round2(
      ((netto_jaarhuur + waardestijging_jaar) / (vraagprijs + kosten_koper)) * 100
    );

    return res.status(200).json({
      max_bod: Math.round(max_bod),
      vraagprijs,
      verschil: Math.round(verschil),
      advies,
      netto_jaarhuur: Math.round(netto_jaarhuur),
      bruto_jaarhuur: Math.round(bruto),
      bezetting: airroi.bezetting != null ? round2(airroi.bezetting) : null,
      gemiddelde_dagprijs: airroi.gemiddelde_dagprijs != null ? Math.round(airroi.gemiddelde_dagprijs) : null,
      waardestijging_jaar: Math.round(waardestijging_jaar),
      totaal_rendement_pct,
      locatie: [location.locality, location.region, location.country].filter(Boolean).join(', '),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
