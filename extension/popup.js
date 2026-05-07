const API_URL = 'https://str-backend.vercel.app/api/bereken';

function euro(n) {
  return '€' + Math.round(n).toLocaleString('nl-NL');
}

function pct(n) {
  return (Math.round(n * 10) / 10) + '%';
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

function showResultaat(data) {
  document.getElementById('r-max-bod').textContent    = euro(data.max_bod);
  document.getElementById('r-vraagprijs').textContent = euro(data.vraagprijs);
  document.getElementById('r-bruto').textContent      = euro(data.bruto_jaarhuur);
  document.getElementById('r-netto').textContent      = euro(data.netto_jaarhuur);
  document.getElementById('r-bezetting').textContent  = pct(data.bezetting * 100);
  document.getElementById('r-dagprijs').textContent   = euro(data.gemiddelde_dagprijs);
  document.getElementById('r-rendement').textContent  = data.totaal_rendement_pct + '%';
  document.getElementById('advies').textContent       = data.advies;
  document.getElementById('resultaat').style.display  = 'block';
}

document.getElementById('berekenBtn').addEventListener('click', async () => {
  const adres           = document.getElementById('adres').value.trim();
  const vraagprijs      = parseFloat(document.getElementById('vraagprijs').value);
  const slaapkamers     = parseInt(document.getElementById('slaapkamers').value, 10);
  const target_rendement = parseFloat(document.getElementById('target_rendement').value);
  const airbnb_fee_pct  = parseFloat(document.getElementById('airbnb_fee').value);
  const management_fee_pct = parseFloat(document.getElementById('management_fee').value);
  const property_tax_pct = parseFloat(document.getElementById('property_tax').value);

  if (!adres) { setStatus('Vul een adres in.', true); return; }
  if (!vraagprijs || vraagprijs <= 0) { setStatus('Vul een geldige vraagprijs in.', true); return; }

  const btn = document.getElementById('berekenBtn');
  btn.disabled = true;
  document.getElementById('resultaat').style.display = 'none';
  setStatus('AirROI data ophalen…');

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adres,
        vraagprijs,
        slaapkamers,
        target_rendement,
        kosten: { airbnb_fee_pct, management_fee_pct, property_tax_pct },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Fout bij ophalen data.', true);
      return;
    }

    setStatus('');
    showResultaat(data);

    // Sla laatste adres op voor volgend gebruik
    chrome.storage.local.set({ laatste_adres: adres });

  } catch (err) {
    setStatus('Verbindingsfout. Controleer je internet.', true);
  } finally {
    btn.disabled = false;
  }
});

// Herstel laatste adres bij openen popup
chrome.storage.local.get('laatste_adres', ({ laatste_adres }) => {
  if (laatste_adres) document.getElementById('adres').value = laatste_adres;
});
