// functions/api/tidalvectors.js
// Cloudflare Pages Function — route: GET /api/tidalvectors
// Optioneel: /api/tidalvectors?time=2026-08-10T12:00:00Z (anders: huidig tijdstip)
//
// Haalt server-side de geocentrische Maan- en Zonvector op bij JPL Horizons
// en berekent de aarde->barycentrum vector. Draait op Cloudflare's servers,
// dus geen CORS-probleem voor de browser.

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";

const BODY_ID = {
  moon: "301",
  sun: "10"
};

// M_maan / M_aarde
const MASS_RATIO_MOON_EARTH = 1 / 81.30056;

// Zet een JS Date om naar het formaat dat Horizons verwacht: YYYY-MMM-DD HH:MM
function toHorizonsTime(date) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const y = date.getUTCFullYear();
  const m = MONTHS[date.getUTCMonth()];
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

// Bouwt de Horizons-URL op voor een gegeven object en tijdstip.
// STOP_TIME ligt 1 minuut na START_TIME; we gebruiken enkel de eerste regel.
function buildHorizonsUrl(bodyId, isoDate) {
  const startTime = toHorizonsTime(isoDate);
  const stopDate = new Date(isoDate.getTime() + 60 * 1000);
  const stopTime = toHorizonsTime(stopDate);

  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${bodyId}'`,
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "VECTORS",
    CENTER: "'500@399'",
    REF_PLANE: "FRAME",
    VEC_TABLE: "1",
    OUT_UNITS: "KM-S",
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: "'1m'"
  });

  return `${HORIZONS_URL}?${params.toString()}`;
}

// Parseert X, Y, Z (km) uit het ruwe Horizons tekstblok tussen $$SOE en $$EOE.
// Enkel de eerste tijdstap wordt gebruikt.
function parseVectorFromResultText(resultText) {
  const soeIndex = resultText.indexOf("$$SOE");
  const eoeIndex = resultText.indexOf("$$EOE");
  const block = resultText.slice(soeIndex, eoeIndex);

  const xMatch = block.match(/X\s*=\s*([-\d.E+]+)/);
  const yMatch = block.match(/Y\s*=\s*([-\d.E+]+)/);
  const zMatch = block.match(/Z\s*=\s*([-\d.E+]+)/);

  return {
    x: parseFloat(xMatch[1]),
    y: parseFloat(yMatch[1]),
    z: parseFloat(zMatch[1])
  };
}

// Haalt de geocentrische vector op van 1 hemellichaam op een gegeven tijdstip.
async function fetchVector(bodyId, isoDate) {
  const url = buildHorizonsUrl(bodyId, isoDate);
  const response = await fetch(url);
  const data = await response.json();
  return parseVectorFromResultText(data.result);
}

// r_aarde->barycentrum = (M_maan / (M_aarde + M_maan)) * r_aarde->maan
function computeBarycenterVector(moonVector) {
  const factor = MASS_RATIO_MOON_EARTH / (1 + MASS_RATIO_MOON_EARTH);
  return {
    x: moonVector.x * factor,
    y: moonVector.y * factor,
    z: moonVector.z * factor
  };
}

// Cloudflare Pages Function entry point voor GET-requests.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const timeParam = url.searchParams.get("time");
  const isoDate = timeParam ? new Date(timeParam) : new Date();

  try {
    const moonVector = await fetchVector(BODY_ID.moon, isoDate);
    const sunVector = await fetchVector(BODY_ID.sun, isoDate);
    const barycenterVector = computeBarycenterVector(moonVector);

    return new Response(
      JSON.stringify({ moonVector, sunVector, barycenterVector, time: isoDate.toISOString() }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
