(function () {
  const host = location.hostname;
  const isIdealista = host.includes('idealista.com');
  const isFotocasa = host.includes('fotocasa.es');

  if (!isIdealista && !isFotocasa) return;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function clean(str) {
    return str ? str.trim().replace(/\s+/g, ' ') : '';
  }

  function parsePrice(str) {
    if (!str) return null;
    const digits = str.replace(/[^\d]/g, '');
    const n = parseInt(digits, 10);
    return isNaN(n) || n < 10000 ? null : n;
  }

  function text(selector) {
    const el = document.querySelector(selector);
    return el ? clean(el.textContent) : null;
  }

  // ── Adres detectie ────────────────────────────────────────────────────────

  function detectIdealista() {
    // Prijs
    const priceRaw =
      text('.info-data-price') ||
      text('.info-data-price span') ||
      text('[class*="price-box"]') ||
      text('.price');
    const vraagprijs = parsePrice(priceRaw);

    // Probeer exact adres uit h1
    const h1 = clean(
      text('h1.main-info__title') || text('h1')
    );

    // Locatie-elementen (wijk, stad)
    const minor = text('.main-info__title-minor');
    const breadcrumbs = [...document.querySelectorAll('.breadcrumb a, .breadcrumb li')]
      .map((el) => clean(el.textContent))
      .filter(Boolean);

    // Bepaal nauwkeurigheid
    // Idealista h1 bevat het adres als het "Calle", "Avenida", "Plaza" etc. bevat
    const straatPatroon = /\b(calle|avda|avenida|plaza|paseo|carrer|rua|via|camino|urb|urbanización)\b/i;

    if (h1 && straatPatroon.test(h1)) {
      // Voeg stad toe vanuit minor of laatste breadcrumb
      const stad = minor ? minor.split(',').pop().trim() : (breadcrumbs[breadcrumbs.length - 1] || '');
      const adres = stad ? `${h1}, ${stad}` : h1;
      return { adres, vraagprijs, nauwkeurigheid: 'adres' };
    }

    if (minor) {
      // minor bevat wijk + stad: "Zona Norte, Murcia"
      return { adres: minor, vraagprijs, nauwkeurigheid: 'wijk' };
    }

    if (breadcrumbs.length > 0) {
      const stad = breadcrumbs[breadcrumbs.length - 1];
      return { adres: stad, vraagprijs, nauwkeurigheid: 'stad' };
    }

    return { adres: null, vraagprijs, nauwkeurigheid: null };
  }

  function detectFotocasa() {
    // Prijs
    const priceRaw = text('.re-DetailHeader-price') || text('[class*="DetailHeader-price"]');
    const vraagprijs = parsePrice(priceRaw);

    // Titel
    const h1 = clean(
      text('h1.re-DetailHeader-propertyTitle') || text('h1')
    );

    // Locatie
    const locatieEl = document.querySelector('.re-DetailHeader-location');
    const locatieTekst = locatieEl ? clean(locatieEl.textContent) : null;

    const straatPatroon = /\b(calle|avda|avenida|plaza|paseo|carrer|rua|via|camino|urb|urbanización)\b/i;

    if (h1 && straatPatroon.test(h1)) {
      const stad = locatieTekst ? locatieTekst.split(',').pop().trim() : '';
      const adres = stad ? `${h1}, ${stad}` : h1;
      return { adres, vraagprijs, nauwkeurigheid: 'adres' };
    }

    if (locatieTekst) {
      // Controleer of locatie wijk+stad of alleen stad is
      const delen = locatieTekst.split(',');
      const nauwkeurigheid = delen.length >= 2 ? 'wijk' : 'stad';
      return { adres: locatieTekst, vraagprijs, nauwkeurigheid };
    }

    return { adres: null, vraagprijs, nauwkeurigheid: null };
  }

  // ── Uitvoeren & opslaan ───────────────────────────────────────────────────

  const result = isIdealista ? detectIdealista() : detectFotocasa();

  if (result.adres || result.vraagprijs) {
    chrome.storage.local.set({
      listing_adres: result.adres,
      listing_vraagprijs: result.vraagprijs,
      listing_nauwkeurigheid: result.nauwkeurigheid,
    });
  }
})();
