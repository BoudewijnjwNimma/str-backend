export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { adres } = req.body || {};

  if (!adres) {
    return res.status(400).json({ error: 'Veld "adres" is verplicht' });
  }

  return res.status(200).json({
    adres,
    verwacht_jaarhuur: 18000,
    bezetting: 0.72,
    bron: 'test',
  });
}
