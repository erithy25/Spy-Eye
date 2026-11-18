/**
 * DATUM time zones: which IANA zone a place uses, and civil-time arithmetic on top of the
 * platform's ICU data (`Intl.DateTimeFormat`). No tz database is shipped; Node carries full ICU.
 *
 * `timeZoneFor` maps a country to its primary zone and splits the countries that span several
 * zones by simple latitude/longitude rules. The rules follow the zone borders approximately
 * (tens of kilometres): good enough for the sun, not a cadastral border.
 */

/** ISO 3166-1 alpha-2 → primary IANA zone (the zone of the capital or of most people). */
const PRIMARY_ZONE: Readonly<Record<string, string>> = {
  AD: 'Europe/Andorra', AE: 'Asia/Dubai', AF: 'Asia/Kabul', AG: 'America/Antigua', AI: 'America/Anguilla',
  AL: 'Europe/Tirane', AM: 'Asia/Yerevan', AO: 'Africa/Luanda', AR: 'America/Argentina/Buenos_Aires',
  AS: 'Pacific/Pago_Pago', AT: 'Europe/Vienna', AU: 'Australia/Sydney', AW: 'America/Aruba',
  AX: 'Europe/Mariehamn', AZ: 'Asia/Baku', BA: 'Europe/Sarajevo', BB: 'America/Barbados', BD: 'Asia/Dhaka',
  BE: 'Europe/Brussels', BF: 'Africa/Ouagadougou', BG: 'Europe/Sofia', BH: 'Asia/Bahrain',
  BI: 'Africa/Bujumbura', BJ: 'Africa/Porto-Novo', BL: 'America/St_Barthelemy', BM: 'Atlantic/Bermuda',
  BN: 'Asia/Brunei', BO: 'America/La_Paz', BQ: 'America/Kralendijk', BR: 'America/Sao_Paulo',
  BS: 'America/Nassau', BT: 'Asia/Thimphu', BW: 'Africa/Gaborone', BY: 'Europe/Minsk', BZ: 'America/Belize',
  CA: 'America/Toronto', CC: 'Indian/Cocos', CD: 'Africa/Kinshasa', CF: 'Africa/Bangui',
  CG: 'Africa/Brazzaville', CH: 'Europe/Zurich', CI: 'Africa/Abidjan', CK: 'Pacific/Rarotonga',
  CL: 'America/Santiago', CM: 'Africa/Douala', CN: 'Asia/Shanghai', CO: 'America/Bogota',
  CR: 'America/Costa_Rica', CU: 'America/Havana', CV: 'Atlantic/Cape_Verde', CW: 'America/Curacao',
  CX: 'Indian/Christmas', CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin',
  DJ: 'Africa/Djibouti', DK: 'Europe/Copenhagen', DM: 'America/Dominica', DO: 'America/Santo_Domingo',
  DZ: 'Africa/Algiers', EC: 'America/Guayaquil', EE: 'Europe/Tallinn', EG: 'Africa/Cairo',
  EH: 'Africa/El_Aaiun', ER: 'Africa/Asmara', ES: 'Europe/Madrid', ET: 'Africa/Addis_Ababa',
  FI: 'Europe/Helsinki', FJ: 'Pacific/Fiji', FK: 'Atlantic/Stanley', FM: 'Pacific/Pohnpei',
  FO: 'Atlantic/Faroe', FR: 'Europe/Paris', GA: 'Africa/Libreville', GB: 'Europe/London',
  GD: 'America/Grenada', GE: 'Asia/Tbilisi', GF: 'America/Cayenne', GG: 'Europe/Guernsey',
  GH: 'Africa/Accra', GI: 'Europe/Gibraltar', GL: 'America/Nuuk', GM: 'Africa/Banjul',
  GN: 'Africa/Conakry', GP: 'America/Guadeloupe', GQ: 'Africa/Malabo', GR: 'Europe/Athens',
  GS: 'Atlantic/South_Georgia', GT: 'America/Guatemala', GU: 'Pacific/Guam', GW: 'Africa/Bissau',
  GY: 'America/Guyana', HK: 'Asia/Hong_Kong', HN: 'America/Tegucigalpa', HR: 'Europe/Zagreb',
  HT: 'America/Port-au-Prince', HU: 'Europe/Budapest', ID: 'Asia/Jakarta', IE: 'Europe/Dublin',
  IL: 'Asia/Jerusalem', IM: 'Europe/Isle_of_Man', IN: 'Asia/Kolkata', IO: 'Indian/Chagos',
  IQ: 'Asia/Baghdad', IR: 'Asia/Tehran', IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome', JE: 'Europe/Jersey',
  JM: 'America/Jamaica', JO: 'Asia/Amman', JP: 'Asia/Tokyo', KE: 'Africa/Nairobi', KG: 'Asia/Bishkek',
  KH: 'Asia/Phnom_Penh', KI: 'Pacific/Tarawa', KM: 'Indian/Comoro', KN: 'America/St_Kitts',
  KP: 'Asia/Pyongyang', KR: 'Asia/Seoul', KW: 'Asia/Kuwait', KY: 'America/Cayman', KZ: 'Asia/Almaty',
  LA: 'Asia/Vientiane', LB: 'Asia/Beirut', LC: 'America/St_Lucia', LI: 'Europe/Vaduz',
  LK: 'Asia/Colombo', LR: 'Africa/Monrovia', LS: 'Africa/Maseru', LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg', LV: 'Europe/Riga', LY: 'Africa/Tripoli', MA: 'Africa/Casablanca',
  MC: 'Europe/Monaco', MD: 'Europe/Chisinau', ME: 'Europe/Podgorica', MF: 'America/Marigot',
  MG: 'Indian/Antananarivo', MH: 'Pacific/Majuro', MK: 'Europe/Skopje', ML: 'Africa/Bamako',
  MM: 'Asia/Yangon', MN: 'Asia/Ulaanbaatar', MO: 'Asia/Macau', MP: 'Pacific/Saipan',
  MQ: 'America/Martinique', MR: 'Africa/Nouakchott', MS: 'America/Montserrat', MT: 'Europe/Malta',
  MU: 'Indian/Mauritius', MV: 'Indian/Maldives', MW: 'Africa/Blantyre', MX: 'America/Mexico_City',
  MY: 'Asia/Kuala_Lumpur', MZ: 'Africa/Maputo', NA: 'Africa/Windhoek', NC: 'Pacific/Noumea',
  NE: 'Africa/Niamey', NF: 'Pacific/Norfolk', NG: 'Africa/Lagos', NI: 'America/Managua',
  NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', NP: 'Asia/Kathmandu', NR: 'Pacific/Nauru', NU: 'Pacific/Niue',
  NZ: 'Pacific/Auckland', OM: 'Asia/Muscat', PA: 'America/Panama', PE: 'America/Lima',
  PF: 'Pacific/Tahiti', PG: 'Pacific/Port_Moresby', PH: 'Asia/Manila', PK: 'Asia/Karachi',
  PL: 'Europe/Warsaw', PM: 'America/Miquelon', PN: 'Pacific/Pitcairn', PR: 'America/Puerto_Rico',
  PS: 'Asia/Hebron', PT: 'Europe/Lisbon', PW: 'Pacific/Palau', PY: 'America/Asuncion', QA: 'Asia/Qatar',
  RE: 'Indian/Reunion', RO: 'Europe/Bucharest', RS: 'Europe/Belgrade', RU: 'Europe/Moscow',
  RW: 'Africa/Kigali', SA: 'Asia/Riyadh', SB: 'Pacific/Guadalcanal', SC: 'Indian/Mahe',
  SD: 'Africa/Khartoum', SE: 'Europe/Stockholm', SG: 'Asia/Singapore', SH: 'Atlantic/St_Helena',
  SI: 'Europe/Ljubljana', SJ: 'Arctic/Longyearbyen', SK: 'Europe/Bratislava', SL: 'Africa/Freetown',
  SM: 'Europe/San_Marino', SN: 'Africa/Dakar', SO: 'Africa/Mogadishu', SR: 'America/Paramaribo',
  SS: 'Africa/Juba', ST: 'Africa/Sao_Tome', SV: 'America/El_Salvador', SX: 'America/Lower_Princes',
  SY: 'Asia/Damascus', SZ: 'Africa/Mbabane', TC: 'America/Grand_Turk', TD: 'Africa/Ndjamena',
  TF: 'Indian/Kerguelen', TG: 'Africa/Lome', TH: 'Asia/Bangkok', TJ: 'Asia/Dushanbe', TK: 'Pacific/Fakaofo',
  TL: 'Asia/Dili', TM: 'Asia/Ashgabat', TN: 'Africa/Tunis', TO: 'Pacific/Tongatapu', TR: 'Europe/Istanbul',
  TT: 'America/Port_of_Spain', TV: 'Pacific/Funafuti', TW: 'Asia/Taipei', TZ: 'Africa/Dar_es_Salaam',
  UA: 'Europe/Kyiv', UG: 'Africa/Kampala', UM: 'Pacific/Wake', US: 'America/New_York',
  UY: 'America/Montevideo', UZ: 'Asia/Tashkent', VA: 'Europe/Vatican', VC: 'America/St_Vincent',
  VE: 'America/Caracas', VG: 'America/Tortola', VI: 'America/St_Thomas', VN: 'Asia/Ho_Chi_Minh',
  VU: 'Pacific/Efate', WF: 'Pacific/Wallis', WS: 'Pacific/Apia', XK: 'Europe/Belgrade', YE: 'Asia/Aden',
  YT: 'Indian/Mayotte', ZA: 'Africa/Johannesburg', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare',
};

/** All country codes with a primary zone (for tests and diagnostics). */
export const COUNTRY_ZONES: Readonly<Record<string, string>> = PRIMARY_ZONE;

type Rule = (lat: number, lon: number) => string | null;

const between = (v: number, lo: number, hi: number): boolean => v >= lo && v < hi;

/** Contiguous US and outlying parts reported under "US". */
const US: Rule = (lat, lon) => {
  if (lat < 23 && lon < -154) return 'Pacific/Honolulu';
  if (lat > 51 && lon < -169) return 'America/Adak';
  if (lat > 51 && lon < -129.9) return 'America/Anchorage';
  if (lon > 0 && lat < 21) return 'Pacific/Guam';
  if (lat < -10 && lon < -168) return 'Pacific/Pago_Pago';
  if (between(lat, 17.5, 18.6) && between(lon, -68, -64.5)) {
    return lon > -65.1 ? 'America/St_Thomas' : 'America/Puerto_Rico';
  }
  // Arizona keeps standard time all year.
  if (between(lat, 31.3, 37.0) && between(lon, -114.8, -109.05)) return 'America/Phoenix';
  // Pacific: west of Nevada/Idaho.
  if (lat < 42 && lon < -114.05) return 'America/Los_Angeles';
  if (lat >= 42 && lon < -116.5) return 'America/Los_Angeles';
  if (lat >= 45.5 && lon < -114.5 - (lat - 45.5) * 0.6) return 'America/Los_Angeles'; // Idaho panhandle
  // Mountain. North Dakota: only the south-west keeps mountain time.
  if (between(lat, 45.9, 49.1) && lon > -104.05) {
    if (lat < 47.6 && lon < -101.0) return 'America/Denver';
    if (lon < -97.2) return 'America/Chicago';
  }
  if (lat >= 37 && lon < -102.05) return lat < 44.5 && lon < -111.05 && lat > 42 ? 'America/Boise' : 'America/Denver';
  if (between(lat, 32, 37) && lon < -103.05) return 'America/Denver';
  if (lat < 32 && lon < -104.9) return 'America/Denver';
  if (lat >= 37 && lon < -101.5) return 'America/Denver';
  if (between(lat, 40, 46) && lon < -100.6) return 'America/Denver';
  // Central / Eastern border.
  let centralWestOf: number;
  if (lat < 31) centralWestOf = -85.0; // Florida panhandle
  else if (lat < 35) centralWestOf = -85.2; // Alabama / Georgia
  else if (lat < 37) centralWestOf = -84.8; // Tennessee
  else if (lat < 39.2) centralWestOf = -86.0; // Kentucky
  else if (lat < 41.0) centralWestOf = -87.5; // Indiana / Illinois
  else if (lat < 41.8) centralWestOf = -86.8; // north-west Indiana
  else centralWestOf = -87.5; // Michigan / Wisconsin
  if (lon < centralWestOf) return 'America/Chicago';
  return between(lat, 39.1, 41.76) && between(lon, -87.5, -84.8) ? 'America/Indiana/Indianapolis' : 'America/New_York';
};

const CA: Rule = (lat, lon) => {
  // Newfoundland and south-east Labrador.
  if (lon > -59.5 && lat < 52.0) return 'America/St_Johns';
  if (between(lat, 51.5, 53.6) && lon > -57.1) return 'America/St_Johns';
  // Atlantic: Maritimes, Labrador, lower north shore of Quebec.
  if (lat < 48.0 && lon > -69.05) return 'America/Halifax';
  if (lat >= 51.5 && lat < 60.5 && lon > -64.0) return 'America/Goose_Bay';
  if (lat >= 48 && lat < 52 && lon > -61.6) return 'America/Halifax';
  // Pacific: British Columbia west of the Rockies (BC/Alberta border runs diagonally 49–53.8° N).
  const bcBorder = lat < 49 ? -114.06 : lat < 53.8 ? -114.06 - ((lat - 49) * 5.94) / 4.8 : -120.0;
  if (lat < 60) {
    if (lat >= 55 && lon >= -124 && lon < -120) return 'America/Dawson_Creek';
    if (lon < bcBorder) return 'America/Vancouver';
    if (lon < -110) return 'America/Edmonton';
    if (lon < -101.6) return 'America/Regina';
    if (lon < -90) return 'America/Winnipeg';
    return 'America/Toronto';
  }
  // North of 60°: Yukon, Northwest Territories, Nunavut.
  if (lon < -124 - (lat - 60) * 1.3) return 'America/Whitehorse';
  if (lon < -102) return lat > 66 && lon > -115 ? 'America/Cambridge_Bay' : 'America/Yellowknife';
  if (lon < -85) return 'America/Rankin_Inlet';
  return 'America/Iqaluit';
};

const MX: Rule = (lat, lon) => {
  // Baja California (north): Pacific time with US rules.
  if (lat >= 30.5 && lon < -114.85) return 'America/Tijuana';
  if (between(lat, 28, 30.5) && lon < -113.0) return 'America/Tijuana';
  // Baja California Sur.
  if (lat < 28 && lon < -109.4) return 'America/Mazatlan';
  // Sonora: no daylight saving.
  if (lat >= 26.3 && lon < -108.5) return 'America/Hermosillo';
  // Sinaloa (coast) and Nayarit.
  if (between(lat, 22.4, 27) && lon < -105.4 - (lat - 22.4) * 0.52) return 'America/Mazatlan';
  if (between(lat, 20.75, 22.4) && lon < -104.0) return 'America/Mazatlan';
  // Chihuahua: Ciudad Juárez follows the US, the rest central time.
  if (lat > 31.2 && between(lon, -107.2, -106.0)) return 'America/Ciudad_Juarez';
  if (lat >= 25.6 && between(lon, -109, -103.3)) return 'America/Chihuahua';
  // Quintana Roo: eastern standard time all year.
  if (between(lat, 17.8, 21.7) && lon > -87.6 - ((21.6 - lat) * 1.6) / 3.8) return 'America/Cancun';
  if (lat > 24 && lon > -101.0 && lon < -97) return 'America/Monterrey';
  if (between(lat, 19, 22) && lon > -91.5 && lon < -87.5) return 'America/Merida';
  return 'America/Mexico_City';
};

const BR: Rule = (lat, lon) => {
  if (lon > -33.5) return 'America/Noronha';
  if (lon < -66.6 && lat < -4.5) return 'America/Rio_Branco';
  if (lat >= -9.5) {
    if (lon < -59.8 && lat > 1) return 'America/Boa_Vista';
    if (lon < -57.0) return lat < -7.5 && lon < -60 ? 'America/Porto_Velho' : 'America/Manaus';
  }
  if (between(lat, -18, -9.5)) {
    if (lon < -60 && lat > -13.7) return 'America/Porto_Velho';
    if (lon < -50.8) return 'America/Cuiaba';
  }
  if (between(lat, -24.1, -18) && lon < -51 + (lat + 18) * 0.55) return 'America/Campo_Grande';
  if (lat > -10 && lon > -46) return lon > -37.5 ? 'America/Recife' : 'America/Fortaleza';
  if (between(lat, -18.3, -8.5) && lon > -46.5) return 'America/Bahia';
  if (lat > -13 && lon <= -46) return lon > -50.5 && lat < -5.5 ? 'America/Araguaina' : 'America/Belem';
  return 'America/Sao_Paulo';
};

const RU: Rule = (lat, lon) => {
  if (lon < 0) return 'Asia/Anadyr'; // Chukotka east of 180°
  if (lon < 22.9) return 'Europe/Kaliningrad';
  if (lat >= 60 && lon < 65) return 'Europe/Moscow';
  if (lon < 45.5) return 'Europe/Moscow';
  if (lon < 54.8) {
    if (lat < 54.5) return 'Europe/Samara'; // Saratov, Samara, Ulyanovsk, Astrakhan
    if (lon >= 51.5 && lat < 58.6) return 'Europe/Samara'; // Udmurtia
    return 'Europe/Moscow'; // Tatarstan, Kirov
  }
  if (lon < 68 && lat < 63) return 'Asia/Yekaterinburg';
  if (lat >= 63 && lon < 85) return 'Asia/Yekaterinburg'; // Yamal
  if (lon < 76) return 'Asia/Omsk';
  if (lon < 86) return 'Asia/Novosibirsk';
  if (lon < 100 || (lat >= 60 && lon < 108)) return 'Asia/Krasnoyarsk';
  if (lon < 108.5 || (lat >= 56 && lon < 116)) return 'Asia/Irkutsk';
  if (lat < 50 && lon > 130.5 && lon < 141.6) return 'Asia/Vladivostok'; // Primorye, Khabarovsk, Birobidzhan
  if (lon < 134 || (lat >= 55 && lon < 140)) return 'Asia/Yakutsk';
  if (lat < 55 && lon < 141.6) return 'Asia/Vladivostok';
  if (lat < 54.5 && lon < 156.5) return 'Asia/Sakhalin';
  if (lon < 147) return 'Asia/Vladivostok';
  if (lat < 62 && lon >= 155.5) return 'Asia/Kamchatka';
  if (lon < 160 || lat < 62) return 'Asia/Magadan';
  return 'Asia/Anadyr';
};

const AU: Rule = (lat, lon) => {
  if (lon > 155) return lat < -50 ? 'Antarctica/Macquarie' : 'Australia/Lord_Howe';
  if (lon < 129) {
    return between(lat, -32.6, -31) && lon >= 125.5 ? 'Australia/Eucla' : 'Australia/Perth';
  }
  if (lat < -39.5) return 'Australia/Hobart';
  if (lon < 138 && lat > -26) return 'Australia/Darwin';
  if (lon < 141) return 'Australia/Adelaide';
  if (between(lat, -33.5, -29) && lon < 142) return 'Australia/Broken_Hill';
  if (lat > -29.0 + (lon > 151 ? 0.8 : 0)) return 'Australia/Brisbane';
  if (lat < -36 && lon < 148) return 'Australia/Melbourne';
  if (lat < -34 && lon < 144.5 && lat < -34 - (lon - 141) * 0.55) return 'Australia/Melbourne';
  return 'Australia/Sydney';
};

const ID: Rule = (lat, lon) => {
  if (lon < 114.5) return lat > -4 && lon > 108.5 ? 'Asia/Pontianak' : 'Asia/Jakarta';
  if (lon < 125.5 || (lat > 3 && lon < 127)) return 'Asia/Makassar';
  return 'Asia/Jayapura';
};

const KZ: Rule = (_lat, lon) => (lon < 61 ? 'Asia/Aqtobe' : 'Asia/Almaty');
const MN: Rule = (_lat, lon) => (lon < 100 ? 'Asia/Hovd' : 'Asia/Ulaanbaatar');
const CD: Rule = (lat, lon) => ((lat > -3 && lon < 24) || (lat <= -3 && lon < 19.8) ? 'Africa/Kinshasa' : 'Africa/Lubumbashi');

const CL: Rule = (lat, lon) => {
  if (lon < -100) return 'Pacific/Easter';
  if (lat < -48.5) return 'America/Punta_Arenas';
  return 'America/Santiago';
};

const AR: Rule = (lat, lon) => {
  if (lat < -52.5) return 'America/Argentina/Ushuaia';
  if (lat < -46) return 'America/Argentina/Rio_Gallegos';
  if (lat > -28 && lon < -64) return lat > -24.5 ? 'America/Argentina/Jujuy' : 'America/Argentina/Salta';
  if (between(lat, -37.5, -32) && lon < -66.5) return 'America/Argentina/Mendoza';
  if (between(lat, -32, -28) && lon < -67) return 'America/Argentina/San_Juan';
  if (between(lat, -35, -29.5) && between(lon, -66, -61.8)) return 'America/Argentina/Cordoba';
  return 'America/Argentina/Buenos_Aires';
};

const PT: Rule = (lat, lon) => {
  if (lon < -24) return 'Atlantic/Azores';
  if (lon < -15 && lat < 34) return 'Atlantic/Madeira';
  return 'Europe/Lisbon';
};

const ES: Rule = (lat, lon) => {
  if (lat < 30 && lon < -13) return 'Atlantic/Canary';
  if (lat < 36 && lon > -5.5 && lon < -2.8) return 'Africa/Ceuta';
  return 'Europe/Madrid';
};

const EC: Rule = (_lat, lon) => (lon < -85 ? 'Pacific/Galapagos' : 'America/Guayaquil');

const NZ: Rule = (_lat, lon) => (lon < -175 && lon > -178 ? 'Pacific/Chatham' : 'Pacific/Auckland');

/** France and its overseas regions, which are sometimes reported under "FR". */
const FR: Rule = (lat, lon) => {
  if (between(lat, 41, 51.6) && between(lon, -5.5, 10)) return 'Europe/Paris';
  if (between(lat, 46.5, 47.3) && between(lon, -56.6, -56)) return 'America/Miquelon';
  if (between(lat, 17.8, 18.2) && between(lon, -63.2, -62.7)) return 'America/Marigot';
  if (between(lat, 15.8, 16.6) && between(lon, -62, -60.9)) return 'America/Guadeloupe';
  if (between(lat, 14.3, 15.0) && between(lon, -61.3, -60.7)) return 'America/Martinique';
  if (between(lat, 1.5, 6.5) && between(lon, -55, -51)) return 'America/Cayenne';
  if (between(lat, -21.5, -20.7) && between(lon, 55, 56)) return 'Indian/Reunion';
  if (between(lat, -13.2, -12.4) && between(lon, 44.8, 45.5)) return 'Indian/Mayotte';
  if (between(lat, -23.5, -18) && between(lon, 163, 169)) return 'Pacific/Noumea';
  if (between(lat, -15, -13) && between(lon, -178.5, -175.8)) return 'Pacific/Wallis';
  if (between(lat, -28.5, -7) && between(lon, -155, -134)) return PF(lat, lon);
  if (lat < -37 && between(lon, 37, 78)) return 'Indian/Kerguelen';
  return null;
};

const PF: Rule = (lat, lon) => {
  if (lat > -11) return 'Pacific/Marquesas';
  if (lon > -137) return 'Pacific/Gambier';
  return 'Pacific/Tahiti';
};

const OTHER: Readonly<Record<string, Rule>> = {
  FM: (_lat, lon) => (lon < 154 ? 'Pacific/Chuuk' : lon > 162 ? 'Pacific/Kosrae' : 'Pacific/Pohnpei'),
  KI: (_lat, lon) => (lon < 0 && lon > -160 ? 'Pacific/Kiritimati' : lon < 0 ? 'Pacific/Kanton' : 'Pacific/Tarawa'),
  PG: (_lat, lon) => (lon > 154 ? 'Pacific/Bougainville' : 'Pacific/Port_Moresby'),
  UM: (_lat, lon) => (lon < 0 ? 'Pacific/Midway' : 'Pacific/Wake'),
  GL: (lat, lon) => {
    if (lat > 75 && lon < -60) return 'America/Thule';
    if (lat > 74 && lon > -25) return 'America/Danmarkshavn';
    if (between(lat, 68, 72) && lon > -25) return 'America/Scoresbysund';
    return 'America/Nuuk';
  },
  PS: (_lat, lon) => (lon < 34.6 ? 'Asia/Gaza' : 'Asia/Hebron'),
  MY: (_lat, lon) => (lon > 109 ? 'Asia/Kuching' : 'Asia/Kuala_Lumpur'),
  NO: (lat) => (lat > 74 ? 'Arctic/Longyearbyen' : 'Europe/Oslo'),
  CY: (_lat, lon) => (lon > 33.6 && _lat > 35.1 ? 'Asia/Famagusta' : 'Asia/Nicosia'),
  UA: (lat, lon) => (lat < 46.2 && between(lon, 32.4, 36.7) ? 'Europe/Simferopol' : 'Europe/Kyiv'),
  PF,
  US,
  CA,
  MX,
  BR,
  RU,
  AU,
  ID,
  KZ,
  MN,
  CD,
  CL,
  AR,
  PT,
  ES,
  EC,
  NZ,
  FR,
};

const zoneValidity = new Map<string, boolean>();

/** Whether the platform's ICU knows the zone. */
export function isValidTimeZone(timeZone: string): boolean {
  let ok = zoneValidity.get(timeZone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      ok = true;
    } catch {
      ok = false;
    }
    zoneValidity.set(timeZone, ok);
  }
  return ok;
}

/**
 * Nautical zone from the longitude: `Etc/GMT-1` for 15° E (UTC+1). The Etc names carry the
 * POSIX sign, which is inverted.
 */
export function etcZoneForLongitude(lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const hours = Math.max(-12, Math.min(12, Math.round(wrapped / 15)));
  if (hours === 0) return 'Etc/GMT';
  return hours > 0 ? `Etc/GMT-${hours}` : `Etc/GMT+${-hours}`;
}

/** The zone the country table and rules name for a point, unchecked (null: none). */
export function ruleZoneFor(lat: number, lon: number, countryIso2: string | null): string | null {
  const iso = countryIso2?.trim().toUpperCase() ?? '';
  const rule = OTHER[iso];
  if (rule !== undefined) return rule(lat, lon);
  return PRIMARY_ZONE[iso] ?? null;
}

/** IANA zone of a place. Unknown countries fall back to the nautical zone of the longitude. */
export function timeZoneFor(lat: number, lon: number, countryIso2: string | null): string {
  const iso = countryIso2?.trim().toUpperCase() ?? '';
  const rule = OTHER[iso];
  if (rule !== undefined) {
    const zone = rule(lat, lon);
    // A rule that knows no zone for the point (e.g. "FR" far from any French territory).
    if (zone === null) return etcZoneForLongitude(lon);
    if (isValidTimeZone(zone)) return zone;
  }
  const primary = PRIMARY_ZONE[iso];
  if (primary !== undefined && isValidTimeZone(primary)) return primary;
  return etcZoneForLongitude(lon);
}

// ---------------------------------------------------------------------------------------------
// Civil time arithmetic
// ---------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilParts(t: number, timeZone: string): CivilParts {
  const parts = formatter(timeZone).formatToParts(new Date(t));
  const out: CivilParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  let bc = false;
  for (const p of parts) {
    switch (p.type) {
      case 'year':
        out.year = Number(p.value);
        break;
      case 'month':
        out.month = Number(p.value);
        break;
      case 'day':
        out.day = Number(p.value);
        break;
      case 'hour':
        out.hour = Number(p.value) % 24;
        break;
      case 'minute':
        out.minute = Number(p.value);
        break;
      case 'second':
        out.second = Number(p.value);
        break;
      case 'era':
        bc = /^B/i.test(p.value);
        break;
      default:
        break;
    }
  }
  if (bc) out.year = 1 - out.year;
  return out;
}

/** Offset of local civil time from UTC at instant `t`, in minutes (Berlin summer: +120). */
export function utcOffsetMin(t: number, timeZone: string): number {
  const whole = Math.floor(t / 1000) * 1000;
  const p = civilParts(whole, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - whole) / 60000);
}

/** Minutes after local midnight (fractional, 0 ≤ m < 1440). */
export function localMinutes(t: number, timeZone: string): number {
  const offset = utcOffsetMin(t, timeZone);
  const local = t + offset * 60000;
  const day = 86400000;
  return (((local % day) + day) % day) / 60000;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function ymdOfUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const ys = y >= 0 && y <= 9999 ? String(y).padStart(4, '0') : String(y);
  return `${ys}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Local calendar date (YYYY-MM-DD) at instant `t`. */
export function localDateYmd(t: number, timeZone: string): string {
  const offset = utcOffsetMin(t, timeZone);
  return ymdOfUtcDate(new Date(t + offset * 60000));
}

/** Parses YYYY-MM-DD; throws on malformed input. */
export function parseYmd(dateYmd: string): { year: number; month: number; day: number } {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  if (!m) throw new Error(`Ungültiges Datum: ${dateYmd}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`Ungültiges Datum: ${dateYmd}`);
  return { year, month, day };
}

/** The date `days` calendar days after `dateYmd`. */
export function addDaysYmd(dateYmd: string, days: number): string {
  const { year, month, day } = parseYmd(dateYmd);
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day + days);
  return ymdOfUtcDate(d);
}

/**
 * Instant at which local civil time in `timeZone` reads `minutes` after midnight of `dateYmd`.
 * Times inside a daylight-saving gap are moved forward by the size of the gap (02:30 on the
 * spring-forward night in Berlin becomes 03:30 CEST); ambiguous times in the autumn overlap
 * resolve to the earlier instant.
 */
export function localToUtc(dateYmd: string, minutes: number, timeZone: string): number {
  const { year, month, day } = parseYmd(dateYmd);
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  const local = d.getTime() + minutes * 60000;
  const before = utcOffsetMin(local - 86400000, timeZone);
  const after = utcOffsetMin(local + 86400000, timeZone);
  const valid: number[] = [];
  for (const offset of new Set([before, after, utcOffsetMin(local, timeZone)])) {
    const t = local - offset * 60000;
    if (utcOffsetMin(t, timeZone) === offset) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);
  // Gap: interpret with the offset in force before the transition.
  return local - before * 60000;
}

/** Start (inclusive) and end (exclusive) of the local calendar day as instants. */
export function localDayBounds(dateYmd: string, timeZone: string): { start: number; end: number } {
  return { start: localToUtc(dateYmd, 0, timeZone), end: localToUtc(addDaysYmd(dateYmd, 1), 0, timeZone) };
}
