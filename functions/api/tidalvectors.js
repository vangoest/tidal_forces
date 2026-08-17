// functions/api/tidalvectors.js
// Cloudflare Pages Function — route: GET /api/tidalvectors
// Optioneel: /api/tidalvectors?time=2026-08-10T12:00:00Z (anders: huidig tijdstip)
//
// Haalt server-side de geocentrische Maan- en Zonvector op bij JPL Horizons
// (eclipticaal J2000) en zet die om naar sublunaire/subsolaire breedte- en
// lengtegraad (aardvast) — precies het DATA-formaat dat index.html verwacht.

const HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";

const BODY_ID = {
  moon: "301",
  sun: "10"
};

// Scheve stand van de ecliptica t.o.v. de evenaar, op epoch J2000.0 (graden)
const OBLIQUITY_J2000_DEG = 23.4392911;

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

// Haalt de geocentrische, eclipticale J2000-vector op van 1 hemellichaam.
async function fetchVector(bodyId, isoDate) {
  const url = buildHorizonsUrl(bodyId, isoDate);
  const response = await fetch(url);
  const data = await response.json();
  return parseVectorFromResultText(data.result);
}

function vectorLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// Eclipticaal J2000 -> equatoriaal J2000: rotatie om de X-as met de
// scheve-ecliptica-hoek. Standaardtransformatie (bv. Meeus, Astronomical
// Algorithms, hfst. 25-26).
function eclipticToEquatorial(v) {
  const eps = OBLIQUITY_J2000_DEG * Math.PI / 180;
  return {
    x: v.x,
    y: v.y * Math.cos(eps) - v.z * Math.sin(eps),
    z: v.y * Math.sin(eps) + v.z * Math.cos(eps)
  };
}

// Greenwich Mean Sidereal Time (graden) op een gegeven UTC-tijdstip.
// Standaardformule (IAU 1982 / Vallado), UTC gebruikt als proxy voor UT1
// (verschil < 1 seconde, verwaarloosbaar op dit precisieniveau).
function computeGmstDeg(date) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const D = JD - 2451545.0;
  const T = D / 36525;
  const gmst = 280.46061837
    + 360.98564736629 * D
    + 0.000387933 * T * T
    - (T * T * T) / 38710000;
  return ((gmst % 360) + 360) % 360;
}

// Sub-punt (breedte/lengte, aardvast) van een equatoriale J2000-vector,
// gegeven de GMST op hetzelfde tijdstip. Lengtegraad oost-positief.
function computeSubPoint(vectorEq, gmstDeg) {
  const r = vectorLength(vectorEq);
  const raDeg = Math.atan2(vectorEq.y, vectorEq.x) * 180 / Math.PI;
  const decDeg = Math.asin(vectorEq.z / r) * 180 / Math.PI;

  let lonDeg = ((raDeg - gmstDeg) % 360 + 360) % 360;
  if (lonDeg > 180) lonDeg -= 360;

  return { lat: decDeg, lon: lonDeg };
}

// Cloudflare Pages Function entry point voor GET-requests.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const timeParam = url.searchParams.get("time");
  const isoDate = timeParam ? new Date(timeParam) : new Date();

  try {
    const moonVectorEcl = await fetchVector(BODY_ID.moon, isoDate);
    const sunVectorEcl = await fetchVector(BODY_ID.sun, isoDate);

    const moonVectorEq = eclipticToEquatorial(moonVectorEcl);
    const sunVectorEq = eclipticToEquatorial(sunVectorEcl);

    const gmstDeg = computeGmstDeg(isoDate);
    const moonSub = computeSubPoint(moonVectorEq, gmstDeg);
    const sunSub = computeSubPoint(sunVectorEq, gmstDeg);

    const data = {
      timestamp_utc: isoDate.toISOString(),
      distance_km: vectorLength(moonVectorEcl),
      sun_distance_km: vectorLength(sunVectorEcl),
      sublunar_lat_deg: moonSub.lat,
      sublunar_lon_deg: moonSub.lon,
      subsolar_lat_deg: sunSub.lat,
      subsolar_lon_deg: sunSub.lon
    };

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
