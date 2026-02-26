import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser({
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SituationMonitor/1.0; +https://situation-monitor.vercel.app)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  },
});

/**
 * GET /api/global-threats
 *
 * Fetches conflict stories from multiple international RSS feeds,
 * aggregated by country.  Displays the 50 most severe conflict zones from
 * the CLED Conflict Index, categorised as Extreme, High, or Turbulent.
 * Stories are sourced from BBC, Guardian, Sky News, France 24, Euronews, DW,
 * Al Jazeera, Al Arabiya, TRT World, Jerusalem Post, The National, CNA,
 * WION, Times of India, NHK, and CBC.
 *
 * Refreshed every 30 minutes by the Vercel cron job (vercel.json).
 */

// ── RSS sources — name, URL, and whether keyword filtering is needed ──
const RSS_SOURCES: { name: string; url: string; preFiltered: boolean }[] = [
  // Pre-filtered conflict feeds (no keyword filtering needed)
  { name: 'Al Jazeera',     url: 'https://www.aljazeera.com/xml/rss/subjects/conflict.xml',     preFiltered: true  },
  // World news feeds (keyword filtering applied)
  { name: 'BBC',            url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                 preFiltered: false },
  { name: 'Guardian',       url: 'https://www.theguardian.com/world/rss',                       preFiltered: false },
  { name: 'Sky News',       url: 'https://feeds.skynews.com/feeds/rss/world.xml',               preFiltered: false },
  { name: 'France 24',      url: 'https://www.france24.com/en/rss',                             preFiltered: false },
  { name: 'Euronews',       url: 'https://feeds.feedburner.com/euronews/en/news',               preFiltered: false },
  { name: 'DW',             url: 'https://rss.dw.com/xml/rss-en-world',                        preFiltered: false },
  { name: 'Al Arabiya',     url: 'https://www.alarabiya.net/tools/rss/en.xml',                  preFiltered: false },
  { name: 'TRT World',      url: 'https://trtworld.com/rss',                                    preFiltered: false },
  { name: 'Jerusalem Post', url: 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx',            preFiltered: false },
  { name: 'The National',   url: 'https://www.thenationalnews.com/rss/',                        preFiltered: false },
  { name: 'CNA',            url: 'https://www.channelnewsasia.com/rssfeeds/8395986',            preFiltered: false },
  { name: 'WION',           url: 'https://www.wionews.com/feeds/world.xml',                     preFiltered: false },
  { name: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',  preFiltered: false },
  { name: 'NHK',            url: 'https://www3.nhk.or.jp/rss/news/cat6.xml',                   preFiltered: false },
  { name: 'CBC',            url: 'https://www.cbc.ca/cmlink/rss-world',                        preFiltered: false },
];

const ARTICLES_LIMIT = 30;

// ── Conflict keyword filter (applied to non-pre-filtered feeds) ───────
const CONFLICT_KEYWORDS = /\b(killed?|dead|deaths?|casualties|attack(?:ed|s)?|bombing|bomb(?:ed|s)?|shooting|shot|missile|airstrike|air.?strike|fighting|clashes?|war|conflict|offensive|explosion|wounded|injured|troops|military|invasion|assault|terror|terrorist|hostage|siege|massacre|genocide|ceasefire|insurgent|rebel|militia)\b/i;

// ── Casualty extraction (used for display in tooltips only) ───
const CASUALTY_RE = /(?:(\d{1,5})\s+(?:killed|dead|casualties|deaths|wounded|injured))|(?:(?:killed|dead|casualties|deaths|wounded|injured)\s+(\d{1,5}))/gi;

function extractCasualties(text: string): number | null {
  let max = 0;
  let found = false;
  let m: RegExpExecArray | null;
  CASUALTY_RE.lastIndex = 0;
  while ((m = CASUALTY_RE.exec(text)) !== null) {
    const n = parseInt(m[1] ?? m[2], 10);
    if (!isNaN(n) && n > max) { max = n; found = true; }
  }
  return found ? max : null;
}

// ── Severity classification (CLED Conflict Index categories) ──
export type GlobalThreatSeverity = 'extreme' | 'high' | 'turbulent';

const SEVERITY_RANK: Record<GlobalThreatSeverity, number> = { extreme: 2, high: 1, turbulent: 0 };

// ── CLED Conflict Index — 50 most severe conflict zones ───────
// Extreme (10): CLED top tier.  High (40): CLED second tier.
// Stories are populated from Al Jazeera; zones always appear on the map.
const KNOWN_CONFLICT_ZONES: {
  pattern: RegExp;
  country: string;
  lat: number;
  lon: number;
  defaultSeverity: GlobalThreatSeverity;
}[] = [
  // ── Extreme ───────────────────────────────────────────────────
  { pattern: /\bpalestine\b|\bgaza\b/i,               country: 'Palestine',                lat: 31.4,  lon:  34.4,  defaultSeverity: 'extreme' },
  { pattern: /\bmyanmar\b|\bburma\b/i,                country: 'Myanmar',                  lat: 19.7,  lon:  96.1,  defaultSeverity: 'extreme' },
  { pattern: /\bsyria\b/i,                            country: 'Syria',                    lat: 34.8,  lon:  38.5,  defaultSeverity: 'extreme' },
  { pattern: /\bmexico\b/i,                           country: 'Mexico',                   lat: 23.6,  lon: -102.6, defaultSeverity: 'extreme' },
  { pattern: /\bnigeria\b/i,                          country: 'Nigeria',                  lat:  9.1,  lon:   8.7,  defaultSeverity: 'extreme' },
  { pattern: /\becuador\b/i,                          country: 'Ecuador',                  lat: -1.8,  lon: -78.2,  defaultSeverity: 'extreme' },
  { pattern: /\bbrazil\b/i,                           country: 'Brazil',                   lat: -14.2, lon: -51.9,  defaultSeverity: 'extreme' },
  { pattern: /\bhaiti\b/i,                            country: 'Haiti',                    lat: 18.9,  lon: -72.3,  defaultSeverity: 'extreme' },
  { pattern: /\bsudan\b(?!\s+south)/i,                country: 'Sudan',                    lat: 15.5,  lon:  30.0,  defaultSeverity: 'extreme' },
  { pattern: /\bpakistan\b/i,                         country: 'Pakistan',                 lat: 30.4,  lon:  69.3,  defaultSeverity: 'extreme' },
  // ── High ──────────────────────────────────────────────────────
  { pattern: /\bcameroon\b/i,                         country: 'Cameroon',                 lat:  3.8,  lon:  11.5,  defaultSeverity: 'high'    },
  { pattern: /\bdrc\b|democratic\s+republic\s+of\s+congo|(?<!\brepublic\s+of\s+)congo/i, country: 'DR Congo', lat: -4.0, lon: 21.8, defaultSeverity: 'high' },
  { pattern: /\bukraine\b/i,                          country: 'Ukraine',                  lat: 48.4,  lon:  31.2,  defaultSeverity: 'high'    },
  { pattern: /\bcolombia\b|\bcolumbia\b/i,            country: 'Colombia',                 lat:  4.7,  lon: -74.1,  defaultSeverity: 'high'    },
  { pattern: /\byemen\b|\bhouthi\b|\bhuthi\b/i,       country: 'Yemen',                    lat: 15.5,  lon:  48.5,  defaultSeverity: 'high'    },
  { pattern: /\bindia\b/i,                            country: 'India',                    lat: 20.6,  lon:  79.0,  defaultSeverity: 'high'    },
  { pattern: /\bguatemala\b/i,                        country: 'Guatemala',                lat: 15.8,  lon: -90.2,  defaultSeverity: 'high'    },
  { pattern: /\bsomalia\b/i,                          country: 'Somalia',                  lat:  5.2,  lon:  46.2,  defaultSeverity: 'high'    },
  { pattern: /\blebanon\b/i,                          country: 'Lebanon',                  lat: 33.9,  lon:  35.5,  defaultSeverity: 'high'    },
  { pattern: /\brussia\b/i,                           country: 'Russia',                   lat: 61.5,  lon: 105.3,  defaultSeverity: 'high'    },
  { pattern: /\bbangladesh\b/i,                       country: 'Bangladesh',               lat: 23.7,  lon:  90.4,  defaultSeverity: 'high'    },
  { pattern: /\bethiopia\b|\btigray\b/i,              country: 'Ethiopia',                 lat:  9.0,  lon:  40.5,  defaultSeverity: 'high'    },
  { pattern: /\biraq\b/i,                             country: 'Iraq',                     lat: 33.3,  lon:  44.4,  defaultSeverity: 'high'    },
  { pattern: /\bkenya\b/i,                            country: 'Kenya',                    lat: -1.3,  lon:  36.8,  defaultSeverity: 'high'    },
  { pattern: /south\s*sudan/i,                        country: 'South Sudan',              lat:  6.9,  lon:  31.3,  defaultSeverity: 'high'    },
  { pattern: /\bhonduras\b/i,                         country: 'Honduras',                 lat: 15.2,  lon: -86.2,  defaultSeverity: 'high'    },
  { pattern: /\bmali\b|\bsahel\b/i,                   country: 'Mali',                     lat: 12.7,  lon:  -8.0,  defaultSeverity: 'high'    },
  { pattern: /\bjamaica\b/i,                          country: 'Jamaica',                  lat: 18.1,  lon: -77.3,  defaultSeverity: 'high'    },
  { pattern: /central\s*african\s*republic/i,         country: 'Central African Republic', lat:  6.6,  lon:  20.9,  defaultSeverity: 'high'    },
  { pattern: /\bburundi\b/i,                          country: 'Burundi',                  lat: -3.4,  lon:  29.9,  defaultSeverity: 'high'    },
  { pattern: /\bphilippines\b|\bfilipino\b/i,         country: 'Philippines',              lat: 12.9,  lon: 122.0,  defaultSeverity: 'high'    },
  { pattern: /\bafghanistan\b/i,                      country: 'Afghanistan',              lat: 34.5,  lon:  69.2,  defaultSeverity: 'high'    },
  { pattern: /\btrinidad\b/i,                         country: 'Trinidad and Tobago',      lat: 10.7,  lon: -61.5,  defaultSeverity: 'high'    },
  { pattern: /\bvenezuela\b/i,                        country: 'Venezuela',                lat:  6.4,  lon: -66.6,  defaultSeverity: 'high'    },
  { pattern: /\bliby/i,                               country: 'Libya',                    lat: 26.3,  lon:  17.2,  defaultSeverity: 'high'    },
  { pattern: /\bniger\b/i,                            country: 'Niger',                    lat: 17.6,  lon:   8.1,  defaultSeverity: 'high'    },
  { pattern: /\bburkina\b/i,                          country: 'Burkina Faso',             lat: 12.4,  lon:  -1.6,  defaultSeverity: 'high'    },
  { pattern: /\bpuerto\s*rico\b/i,                    country: 'Puerto Rico',              lat: 18.2,  lon: -66.6,  defaultSeverity: 'high'    },
  { pattern: /\bmozambique\b/i,                       country: 'Mozambique',               lat: -18.7, lon:  35.5,  defaultSeverity: 'high'    },
  { pattern: /\biran\b/i,                             country: 'Iran',                     lat: 32.0,  lon:  53.0,  defaultSeverity: 'high'    },
  { pattern: /\buganda\b/i,                           country: 'Uganda',                   lat:  1.4,  lon:  32.3,  defaultSeverity: 'high'    },
  { pattern: /\bisrael\b/i,                           country: 'Israel',                   lat: 31.8,  lon:  35.2,  defaultSeverity: 'high'    },
  { pattern: /\bperu\b/i,                             country: 'Peru',                     lat: -9.2,  lon: -75.0,  defaultSeverity: 'high'    },
  { pattern: /\bghana\b/i,                            country: 'Ghana',                    lat:  7.9,  lon:  -1.0,  defaultSeverity: 'high'    },
  { pattern: /\bindonesia\b/i,                        country: 'Indonesia',                lat: -0.8,  lon: 113.9,  defaultSeverity: 'high'    },
  { pattern: /\bchile\b/i,                            country: 'Chile',                    lat: -35.7, lon: -71.5,  defaultSeverity: 'high'    },
  { pattern: /south\s*africa/i,                       country: 'South Africa',             lat: -30.6, lon:  22.9,  defaultSeverity: 'high'    },
  { pattern: /\bnepal\b/i,                            country: 'Nepal',                    lat: 28.4,  lon:  84.1,  defaultSeverity: 'high'    },
  { pattern: /\bbelize\b/i,                           country: 'Belize',                   lat: 17.2,  lon: -88.5,  defaultSeverity: 'high'    },
  { pattern: /\bchad\b/i,                             country: 'Chad',                     lat: 15.5,  lon:  18.7,  defaultSeverity: 'high'    },
  // ── Additional Extreme conflict countries ──────────────────────
  { pattern: /\balgeria\b|\balgerian\b|\balgiers\b/i,              country: 'Algeria',          lat: 28.0,  lon:   2.6,  defaultSeverity: 'extreme'   },
  { pattern: /\bbelarus\b|\bbelarusian\b|\blukashenko\b/i,         country: 'Belarus',          lat: 53.7,  lon:  28.0,  defaultSeverity: 'extreme'   },
  { pattern: /\bbenin\b(?!\s+city)|\bcotonou\b/i,                  country: 'Benin',            lat:  9.3,  lon:   2.3,  defaultSeverity: 'extreme'   },
  { pattern: /\bchina\b|\bchinese\b|\bbeijing\b|\bshanghai\b/i,    country: 'China',            lat: 35.9,  lon: 104.2,  defaultSeverity: 'extreme'   },
  { pattern: /\bcote\s+d.ivoire\b|\bivory\s+coast\b/i,             country: "Côte d'Ivoire",    lat:  7.5,  lon:  -5.5,  defaultSeverity: 'extreme'   },
  { pattern: /\begypt\b|\begyptian\b|\bcairo\b/i,                  country: 'Egypt',            lat: 26.8,  lon:  30.8,  defaultSeverity: 'extreme'   },
  { pattern: /\bel\s+salvador\b|\bsalvadoran\b/i,                  country: 'El Salvador',      lat: 13.8,  lon: -88.9,  defaultSeverity: 'extreme'   },
  { pattern: /\bjordan\b|\bjordanian\b|\bamman\b/i,                 country: 'Jordan',           lat: 30.6,  lon:  36.2,  defaultSeverity: 'extreme'   },
  { pattern: /\bmauritania\b|\bmauritanian\b|\bnouakchott\b/i,      country: 'Mauritania',       lat: 20.3,  lon: -10.3,  defaultSeverity: 'extreme'   },
  { pattern: /\bmorocco\b|\bmorrocco\b|\bmoroccan\b|\brabat\b/i,    country: 'Morocco',          lat: 31.8,  lon:  -7.1,  defaultSeverity: 'extreme'   },
  { pattern: /\bnicaragua\b|\bnicaragu[ae]n\b/i,                   country: 'Nicaragua',        lat: 12.9,  lon: -85.2,  defaultSeverity: 'extreme'   },
  { pattern: /\brwanda\b|\brwandan\b|\bkigali\b/i,                  country: 'Rwanda',           lat: -2.0,  lon:  29.9,  defaultSeverity: 'extreme'   },
  { pattern: /\bthailand\b|\bthai\b|\bbangkok\b/i,                  country: 'Thailand',         lat: 15.9,  lon: 100.9,  defaultSeverity: 'extreme'   },
  { pattern: /\btogo\b|\btogolese\b|\blomé\b/i,                     country: 'Togo',             lat:  8.6,  lon:   1.2,  defaultSeverity: 'extreme'   },
  { pattern: /\btunisia\b|\btunisian\b|\btunis\b/i,                 country: 'Tunisia',          lat: 34.0,  lon:   9.1,  defaultSeverity: 'extreme'   },
  { pattern: /\bunited\s+states?\b|\bU\.?S\.?A\.?\b|\bAmerican\b/i, country: 'United States',   lat: 37.1,  lon: -95.7,  defaultSeverity: 'extreme'   },
  // ── Additional High conflict countries ────────────────────────
  { pattern: /\bsaudi\s+arabia\b|\bsaudi\b|\briyadh\b/i,            country: 'Saudi Arabia',     lat: 24.2,  lon:  45.1,  defaultSeverity: 'high'      },
  { pattern: /\bU\.?A\.?E\.?\b|\bunited\s+arab\s+emirates\b|\bdubai\b|\babu\s+dhabi\b/i, country: 'UAE', lat: 24.0, lon: 53.8, defaultSeverity: 'high' },
  { pattern: /\bturkey\b|\bturkish\b|\bturkiye\b|\bancara\b/i,      country: 'Turkey',           lat: 38.9,  lon:  35.2,  defaultSeverity: 'high'      },
  { pattern: /\btajikistan\b|\btajik\b|\bdushanbe\b/i,              country: 'Tajikistan',       lat: 38.9,  lon:  71.3,  defaultSeverity: 'high'      },
  // ── Additional Turbulent/Low conflict countries ────────────────
  { pattern: /\bangola\b|\bangolan\b|\bluanda\b/i,                   country: 'Angola',           lat: -11.2, lon:  17.9,  defaultSeverity: 'turbulent' },
  { pattern: /\barmenia\b|\barmenian\b/i,                           country: 'Armenia',          lat: 40.1,  lon:  45.0,  defaultSeverity: 'turbulent' },
  { pattern: /\bazerbaijan\b|\bazeri\b/i,                           country: 'Azerbaijan',       lat: 40.1,  lon:  47.6,  defaultSeverity: 'turbulent' },
  { pattern: /\bbhutan\b|\bbhutanese\b|\bthimphu\b/i,               country: 'Bhutan',           lat: 27.5,  lon:  90.4,  defaultSeverity: 'turbulent' },
  { pattern: /\bgambia\b|\bgambian\b|\bbanjul\b/i,                   country: 'Gambia',           lat: 13.4,  lon: -15.3,  defaultSeverity: 'turbulent' },
  { pattern: /\bgeorgia\b(?!\s+(state|peach|tech))/i,               country: 'Georgia',          lat: 42.3,  lon:  43.4,  defaultSeverity: 'turbulent' },
  { pattern: /\blaos?\b|\blao\b|\bvientiane\b/i,                    country: 'Laos',             lat: 19.9,  lon: 102.5,  defaultSeverity: 'turbulent' },
  { pattern: /\bmalaysia\b|\bmalaysian\b|\bkuala\s+lumpur\b/i,       country: 'Malaysia',         lat:  4.2,  lon: 108.0,  defaultSeverity: 'turbulent' },
  { pattern: /\bpapua\s+new\s+guinea\b|\bport\s+moresby\b/i,         country: 'Papua New Guinea', lat: -6.3,  lon: 143.9,  defaultSeverity: 'turbulent' },
  { pattern: /\bparaguay\b|\bparaguayan\b/i,                        country: 'Paraguay',         lat: -23.4, lon: -58.4,  defaultSeverity: 'turbulent' },
  { pattern: /\bsenegal\b|\bsenegalese\b|\bdakar\b/i,                country: 'Senegal',          lat: 14.5,  lon: -14.5,  defaultSeverity: 'turbulent' },
  { pattern: /\btanzania\b|\btanzanian\b|\bdodoma\b|\bdar\s+es\s+salaam\b/i, country: 'Tanzania', lat: -6.4,  lon:  34.9,  defaultSeverity: 'turbulent' },
  { pattern: /\bwestern\s+sahara\b|\bsahrawi\b/i,                    country: 'Western Sahara',   lat: 24.2,  lon: -12.9,  defaultSeverity: 'turbulent' },
];

// ── Additional world countries for global coverage ─────────────
// These supplement KNOWN_CONFLICT_ZONES — they appear in the response ONLY
// when they have at least one active story in the current 24 h window.
const WORLD_COUNTRIES: { pattern: RegExp; country: string; lat: number; lon: number }[] = [
  // ── North America ─────────────────────────────────────────────
  { pattern: /\bunited\s+states?\b|\bU\.?S\.?A\.?\b|\bAmerican\b/i,      country: 'United States',      lat:  37.1, lon:  -95.7 },
  { pattern: /\bcanada\b|\bcanadian\b/i,                                  country: 'Canada',             lat:  56.1, lon: -106.3 },
  { pattern: /\bcuba\b|\bcuban\b/i,                                       country: 'Cuba',               lat:  21.5, lon:  -79.5 },
  { pattern: /\bdominicat?n\s+republic\b|\brepública\s+dominicana\b/i,   country: 'Dominican Republic', lat:  18.7, lon:  -70.2 },
  { pattern: /\bel\s+salvador\b|\bsalvadoran\b/i,                        country: 'El Salvador',        lat:  13.8, lon:  -88.9 },
  { pattern: /\bnicaragua\b|\bnicaragu[ae]n\b/i,                         country: 'Nicaragua',          lat:  12.9, lon:  -85.2 },
  { pattern: /\bpanama\b|\bpanamanian\b/i,                               country: 'Panama',             lat:   8.5, lon:  -80.8 },
  { pattern: /\bcosta\s+rica\b|\bcosta\s+rican\b/i,                      country: 'Costa Rica',         lat:   9.7, lon:  -83.8 },
  // ── South America ─────────────────────────────────────────────
  { pattern: /\bargentina\b|\bargentine\b|\bargentinean\b/i,             country: 'Argentina',          lat: -38.4, lon:  -63.6 },
  { pattern: /\bbolivia\b|\bbolivian\b/i,                                country: 'Bolivia',            lat: -16.3, lon:  -63.6 },
  { pattern: /\bparaguay\b|\bparaguayan\b/i,                             country: 'Paraguay',           lat: -23.4, lon:  -58.4 },
  { pattern: /\buruguay\b|\buruguayan\b/i,                               country: 'Uruguay',            lat: -32.5, lon:  -55.8 },
  { pattern: /\bguyana\b|\bguyanese\b/i,                                 country: 'Guyana',             lat:   4.9, lon:  -58.9 },
  { pattern: /\bsuriname\b|\bsurinamese\b/i,                             country: 'Suriname',           lat:   3.9, lon:  -56.0 },
  // ── Europe ────────────────────────────────────────────────────
  { pattern: /\bunited\s+kingdom\b|\bU\.?K\.?\b|\bBritish\b|\bBritain\b|\bEngland\b|\bScottish\b|\bWales\b/i, country: 'United Kingdom', lat: 55.4, lon: -3.4 },
  { pattern: /\bfrance\b|\bfrench\b|\bparis\b/i,                        country: 'France',             lat:  46.2, lon:    2.2 },
  { pattern: /\bgermany\b|\bgerman\b|\bberlin\b/i,                       country: 'Germany',            lat:  51.2, lon:   10.5 },
  { pattern: /\bspain\b|\bspanish\b|\bmadrid\b/i,                        country: 'Spain',              lat:  40.5, lon:   -3.7 },
  { pattern: /\bital[yi]\b|\bitalian\b|\brome\b/i,                       country: 'Italy',              lat:  41.9, lon:   12.6 },
  { pattern: /\bpoland\b|\bpolish\b|\bwarsaw\b/i,                        country: 'Poland',             lat:  51.9, lon:   19.1 },
  { pattern: /\bserbia\b|\bserbian\b|\bbelgrade\b/i,                     country: 'Serbia',             lat:  44.0, lon:   21.0 },
  { pattern: /\bkosovo\b|\bkosovan\b/i,                                  country: 'Kosovo',             lat:  42.6, lon:   20.9 },
  { pattern: /\bmoldova\b|\bmoldovan\b/i,                                country: 'Moldova',            lat:  47.4, lon:   28.4 },
  { pattern: /\bbelarus\b|\bbelarusian\b|\blukashenko\b/i,               country: 'Belarus',            lat:  53.7, lon:   28.0 },
  { pattern: /\bgeorgia\b(?!\s+(state|peach|tech))/i,                    country: 'Georgia',            lat:  42.3, lon:   43.4 },
  { pattern: /\bazerbaijan\b|\bazeri\b/i,                                country: 'Azerbaijan',         lat:  40.1, lon:   47.6 },
  { pattern: /\barmenia\b|\barmenian\b/i,                                country: 'Armenia',            lat:  40.1, lon:   45.0 },
  { pattern: /\bturkey\b|\bturkish\b|\bturkiye\b|\bancara\b/i,           country: 'Turkey',             lat:  38.9, lon:   35.2 },
  { pattern: /\bgreece\b|\bgreek\b|\bathens\b/i,                         country: 'Greece',             lat:  39.1, lon:   21.8 },
  { pattern: /\bromania\b|\bromanian\b|\bbucharest\b/i,                  country: 'Romania',            lat:  45.9, lon:   25.0 },
  { pattern: /\bhungary\b|\bhungarian\b|\bbudapest\b/i,                  country: 'Hungary',            lat:  47.2, lon:   19.5 },
  { pattern: /\bczech\b|\bprague\b/i,                                    country: 'Czech Republic',     lat:  49.8, lon:   15.5 },
  { pattern: /\bcroatia\b|\bcroatian\b|\bzagreb\b/i,                     country: 'Croatia',            lat:  45.1, lon:   15.2 },
  { pattern: /\bbosnia\b|\bsarajevo\b/i,                                 country: 'Bosnia',             lat:  43.9, lon:   17.7 },
  { pattern: /\balbania\b|\balbanian\b|\btirana\b/i,                     country: 'Albania',            lat:  41.2, lon:   20.2 },
  { pattern: /\bnorth\s+macedo/i,                                        country: 'North Macedonia',    lat:  41.6, lon:   21.7 },
  { pattern: /\bbulgaria\b|\bbulgarian\b|\bsofia\b/i,                    country: 'Bulgaria',           lat:  42.7, lon:   25.5 },
  { pattern: /\bsweden\b|\bswedish\b|\bstockholm\b/i,                   country: 'Sweden',             lat:  60.1, lon:   18.6 },
  { pattern: /\bfinland\b|\bfinnish\b|\bhelsinki\b/i,                    country: 'Finland',            lat:  61.9, lon:   25.7 },
  { pattern: /\bnorway\b|\bnorwegian\b|\boslo\b/i,                       country: 'Norway',             lat:  60.5, lon:    8.5 },
  { pattern: /\bdenmark\b|\bdanish\b|\bcopenhagen\b/i,                   country: 'Denmark',            lat:  56.3, lon:    9.5 },
  { pattern: /\bnetherlands\b|\bdutch\b|\bamsterdam\b/i,                 country: 'Netherlands',        lat:  52.1, lon:    5.3 },
  { pattern: /\bbelgium\b|\bbelgian\b|\bbBrussels\b/i,                   country: 'Belgium',            lat:  50.5, lon:    4.5 },
  { pattern: /\bswitzerland\b|\bswiss\b|\bgeneva\b/i,                    country: 'Switzerland',        lat:  46.8, lon:    8.2 },
  { pattern: /\baustria\b|\baustrian\b|\bvienna\b/i,                     country: 'Austria',            lat:  47.5, lon:   14.6 },
  { pattern: /\bportugal\b|\bportuguese\b|\blisbon\b/i,                  country: 'Portugal',           lat:  39.4, lon:   -8.2 },
  // ── Middle East ───────────────────────────────────────────────
  { pattern: /\bsaudi\s+arabia\b|\bsaudi\b|\briyadh\b/i,                country: 'Saudi Arabia',       lat:  24.2, lon:   45.1 },
  { pattern: /\bjordan\b|\bjordanian\b|\bamman\b/i,                      country: 'Jordan',             lat:  30.6, lon:   36.2 },
  { pattern: /\bkuwait\b|\bkuwaiti\b/i,                                  country: 'Kuwait',             lat:  29.3, lon:   47.5 },
  { pattern: /\bqatar\b|\bqatari\b|\bdoha\b/i,                           country: 'Qatar',              lat:  25.4, lon:   51.2 },
  { pattern: /\bbahrain\b|\bbahraini\b|\bmanama\b/i,                     country: 'Bahrain',            lat:  26.0, lon:   50.6 },
  { pattern: /\boman\b|\bomani\b|\bmuscat\b/i,                           country: 'Oman',               lat:  21.5, lon:   55.9 },
  { pattern: /\bU\.?A\.?E\.?\b|\bunited\s+arab\s+emirates\b|\bdubai\b|\babu\s+dhabi\b/i, country: 'UAE', lat: 24.0, lon: 53.8 },
  // ── Africa ────────────────────────────────────────────────────
  { pattern: /\begypt\b|\begyptian\b|\bcairo\b/i,                        country: 'Egypt',              lat:  26.8, lon:   30.8 },
  { pattern: /\balgeria\b|\balgerian\b|\balgiers\b/i,                    country: 'Algeria',            lat:  28.0, lon:    2.6 },
  { pattern: /\btunisia\b|\btunisian\b|\btunis\b/i,                      country: 'Tunisia',            lat:  34.0, lon:    9.1 },
  { pattern: /\bmorocco\b|\bmorrocco\b|\bmoroccan\b|\brabat\b/i,         country: 'Morocco',            lat:  31.8, lon:   -7.1 },
  { pattern: /\bsenegal\b|\bsenegalese\b|\bdakar\b/i,                    country: 'Senegal',            lat:  14.5, lon:  -14.5 },
  { pattern: /\bguinea\b(?!-bissau)(?!\s+ecuatorial)/i,                  country: 'Guinea',             lat:  11.0, lon:  -10.9 },
  { pattern: /\bguinea-bissau\b/i,                                       country: 'Guinea-Bissau',      lat:  11.8, lon:  -15.2 },
  { pattern: /\bcote\s+d.ivoire\b|\bivory\s+coast\b/i,                   country: "Côte d'Ivoire",      lat:   7.5, lon:   -5.5 },
  { pattern: /\bliberia\b|\bliberian\b|\bmonrovia\b/i,                   country: 'Liberia',            lat:   6.4, lon:   -9.4 },
  { pattern: /\bsierra\s+leone\b/i,                                      country: 'Sierra Leone',       lat:   8.5, lon:  -11.8 },
  { pattern: /\btogo\b|\btogolese\b|\blomé\b/i,                          country: 'Togo',               lat:   8.6, lon:    1.2 },
  { pattern: /\bbenin\b(?!\s+city)|\bcotonou\b/i,                        country: 'Benin',              lat:   9.3, lon:    2.3 },
  { pattern: /\btanzania\b|\btanzanian\b|\bdodoma\b|\bdar\s+es\s+salaam\b/i, country: 'Tanzania',    lat:  -6.4, lon:   34.9 },
  { pattern: /\brwanda\b|\brwandan\b|\bkigali\b/i,                       country: 'Rwanda',             lat:  -2.0, lon:   29.9 },
  { pattern: /\bmalawi\b|\bmalawian\b|\blilongwe\b/i,                    country: 'Malawi',             lat: -13.3, lon:   34.3 },
  { pattern: /\bzambia\b|\bzambian\b|\blusaka\b/i,                       country: 'Zambia',             lat: -13.1, lon:   27.8 },
  { pattern: /\bzimbabwe\b|\bzimbabwean\b|\bharare\b/i,                   country: 'Zimbabwe',           lat: -20.0, lon:   30.0 },
  { pattern: /\bangola\b|\bangolan\b|\bluanda\b/i,                        country: 'Angola',             lat: -11.2, lon:   17.9 },
  { pattern: /\bnamibia\b|\bnamibian\b|\bwindhoek\b/i,                   country: 'Namibia',            lat: -22.7, lon:   17.1 },
  { pattern: /\bbotswana\b|\bbatswana\b|\bgaborone\b/i,                   country: 'Botswana',           lat: -22.3, lon:   24.7 },
  { pattern: /\blesotho\b|\bmaseru\b/i,                                  country: 'Lesotho',            lat: -29.6, lon:   28.2 },
  { pattern: /\beswatini\b|\bswaziland\b|\bmbabane\b/i,                  country: 'Eswatini',           lat: -26.5, lon:   31.5 },
  { pattern: /\bmadag/i,                                                 country: 'Madagascar',         lat: -18.8, lon:   46.9 },
  { pattern: /\bdjibouti\b/i,                                            country: 'Djibouti',           lat:  11.8, lon:   42.6 },
  { pattern: /\beritrea\b|\berittrean\b|\basmara\b/i,                    country: 'Eritrea',            lat:  15.2, lon:   39.8 },
  { pattern: /\bgambia\b|\bgambian\b|\bbanjul\b/i,                       country: 'Gambia',             lat:  13.4, lon:  -15.3 },
  { pattern: /\bcape\s+verde\b|\bcabo\s+verde\b/i,                       country: 'Cape Verde',         lat:  16.0, lon:  -24.0 },
  { pattern: /\bsão\s+tomé\b|\bsao\s+tome\b/i,                          country: 'São Tomé and Príncipe', lat: 0.2, lon: 6.6 },
  { pattern: /\bequatorial\s+guinea\b/i,                                 country: 'Equatorial Guinea',  lat:   1.7, lon:   10.3 },
  { pattern: /\bgabon\b|\bgabonese\b|\blibreville\b/i,                   country: 'Gabon',              lat:  -0.8, lon:   11.6 },
  { pattern: /\brepublic\s+of\s+congo\b|\bcongo.brazzaville\b|\bbrazzaville\b/i, country: 'Republic of Congo', lat: -0.2, lon: 15.8 },
  // ── Asia & Pacific ────────────────────────────────────────────
  { pattern: /\bchina\b|\bchinese\b|\bbeijing\b|\bshanghai\b/i,          country: 'China',              lat:  35.9, lon:  104.2 },
  { pattern: /\bjapan\b|\bjapanese\b|\btokyo\b/i,                        country: 'Japan',              lat:  36.2, lon:  138.3 },
  { pattern: /\bsouth\s+korea\b|\bkorean\b(?!\s+north)|\bseoul\b/i,      country: 'South Korea',        lat:  36.5, lon:  128.0 },
  { pattern: /\bnorth\s+korea\b|\bpyongyang\b|\bkim\s+jong/i,            country: 'North Korea',        lat:  40.3, lon:  127.5 },
  { pattern: /\btaiwan\b|\btaipei\b|\btaiwanese\b/i,                     country: 'Taiwan',             lat:  23.7, lon:  121.0 },
  { pattern: /\bvietnam\b|\bvietnamese\b|\bhanoi\b/i,                    country: 'Vietnam',            lat:  14.1, lon:  108.3 },
  { pattern: /\bthailand\b|\bthai\b|\bbangkok\b/i,                       country: 'Thailand',           lat:  15.9, lon:  100.9 },
  { pattern: /\bcambodia\b|\bcambodian\b|\bkhmer\b|\bphnom\s+penh\b/i,   country: 'Cambodia',           lat:  12.6, lon:  104.9 },
  { pattern: /\blaos?\b|\blao\b|\bvientiane\b/i,                         country: 'Laos',               lat:  19.9, lon:  102.5 },
  { pattern: /\bmalaysia\b|\bmalaysian\b|\bkuala\s+lumpur\b/i,           country: 'Malaysia',           lat:   4.2, lon:  108.0 },
  { pattern: /\bsingapore\b|\bsingaporean\b/i,                           country: 'Singapore',          lat:   1.4, lon:  103.8 },
  { pattern: /\bbrunei\b/i,                                              country: 'Brunei',             lat:   4.5, lon:  114.7 },
  { pattern: /\btimor.leste\b|\beast\s+timor\b|\bdili\b/i,               country: 'Timor-Leste',        lat:  -8.9, lon:  125.7 },
  { pattern: /\bpapua\s+new\s+guinea\b|\bport\s+moresby\b/i,             country: 'Papua New Guinea',   lat:  -6.3, lon:  143.9 },
  { pattern: /\bfiji\b|\bfijian\b|\bsuva\b/i,                            country: 'Fiji',               lat: -17.7, lon:  178.1 },
  { pattern: /\bsri\s+lanka\b|\bceylon\b|\bcolombo\b/i,                  country: 'Sri Lanka',          lat:   7.9, lon:   80.7 },
  { pattern: /\bmaldives\b|\bmaldivian\b|\bmale\b/i,                     country: 'Maldives',           lat:   3.2, lon:   73.2 },
  { pattern: /\bbhutan\b|\bbhutanese\b|\bthimphu\b/i,                    country: 'Bhutan',             lat:  27.5, lon:   90.4 },
  { pattern: /\bkazakhstan\b|\bkazakh\b|\bnur-sultan\b|\bastana\b/i,     country: 'Kazakhstan',         lat:  48.0, lon:   66.9 },
  { pattern: /\buzbekistan\b|\buzbek\b|\btashkent\b/i,                   country: 'Uzbekistan',         lat:  41.4, lon:   64.6 },
  { pattern: /\bkyrgyzstan\b|\bkyrgyz\b|\bbishkek\b/i,                   country: 'Kyrgyzstan',         lat:  41.2, lon:   74.8 },
  { pattern: /\btajikistan\b|\btajik\b|\bdushanbe\b/i,                   country: 'Tajikistan',         lat:  38.9, lon:   71.3 },
  { pattern: /\bturkmenistan\b|\bturkmen\b|\bashgabat\b/i,               country: 'Turkmenistan',       lat:  38.1, lon:   58.4 },
  { pattern: /\bmongolia\b|\bmongolian\b|\bulaanbaatar\b/i,              country: 'Mongolia',           lat:  46.8, lon:  103.9 },
  { pattern: /\baustralia\b|\baustralian\b|\bcanberra\b|\bsydney\b/i,    country: 'Australia',          lat: -25.3, lon:  133.8 },
  { pattern: /\bnew\s+zealand\b|\bnz\b|\bwellington\b|\bauckland\b/i,    country: 'New Zealand',        lat: -41.0, lon:  174.9 },
  { pattern: /\bsolomon\s+islands\b|\bhoniara\b/i,                       country: 'Solomon Islands',    lat:  -9.6, lon:  160.2 },
  { pattern: /\bvanuatu\b|\bport\s+vila\b/i,                             country: 'Vanuatu',            lat: -15.4, lon:  166.9 },
  { pattern: /\bsamoa\b|\bapia\b/i,                                      country: 'Samoa',              lat: -13.8, lon: -172.1 },
  { pattern: /\btonga\b|\bnukualofa\b/i,                                  country: 'Tonga',              lat: -21.2, lon: -175.2 },
];

// ── TTL constants ──────────────────────────────────────────────
const TTL_MS       = 24 * 3600 * 1000;  // 24-hour story TTL (stories expire after 24 h)
const NEW_STORY_MS = 24 * 3600 * 1000;  // ping visible for 24 hours

// ── Output types ───────────────────────────────────────────────
export interface StoryEntry {
  title: string;
  summary: string;
  casualties: number | null;
  date: string;
  link: string;
  source: string;
  createdAt: string;
  expiresAt: string;
}

export interface CountryThreat {
  country: string;
  severity: GlobalThreatSeverity;
  lat: number;
  lon: number;
  hasNew: boolean;
  isTrending: boolean;
  stories: StoryEntry[];
}

// ── Module-level response cache (30-minute TTL) ────────────────
let _cachedResponse: { threats: CountryThreat[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

// ── Main handler ───────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  if (_cachedResponse && Date.now() < _cacheExpiresAt) {
    return json(
      { threats: _cachedResponse.threats, updatedAt: _cachedResponse.updatedAt },
      { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } }
    );
  }

  try {
    // Fetch all RSS feeds in parallel; individual failures are tolerated
    const feedResults = await Promise.allSettled(
      RSS_SOURCES.map(src => parser.parseURL(src.url).then(feed => ({ feed, src })))
    );

    const now = Date.now();

    // Collect raw items across all feeds
    interface RawItem { title: string; link: string; summary: string; pubDate: string; source: string }
    const raw: RawItem[] = [];
    for (const result of feedResults) {
      if (result.status !== 'fulfilled') continue;
      const { feed, src } = result.value;
      for (const item of feed.items.slice(0, ARTICLES_LIMIT)) {
        if (!item.title || !item.link) continue;
        const title   = item.title;
        const summary = item.contentSnippet ?? item.summary ?? item.content ?? '';
        // Apply keyword filter to non-pre-filtered feeds (BBC, Reuters)
        if (!src.preFiltered && !CONFLICT_KEYWORDS.test(`${title} ${summary}`)) continue;
        raw.push({
          title,
          link:    item.link,
          summary,
          pubDate: item.pubDate ?? new Date().toISOString(),
          source:  src.name,
        });
      }
    }

    // Deduplicate by title prefix
    const seen = new Set<string>();
    const unique = raw.filter(item => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: within 24-hour TTL only
    const filtered = unique.filter(item => {
      const age = now - new Date(item.pubDate).getTime();
      return age <= TTL_MS;
    });

    // Map stories to known conflict zones and world countries by pattern matching
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + TTL_MS).toISOString();

    // Build per-country story lists
    const countryStories = new Map<string, StoryEntry[]>();
    for (const item of filtered) {
      const text = `${item.title} ${item.summary}`;
      const casualties = extractCasualties(text);
      let matched = false;
      for (const zone of KNOWN_CONFLICT_ZONES) {
        if (!zone.pattern.test(text)) continue;
        const story: StoryEntry = {
          title:      item.title,
          summary:    item.summary.slice(0, 300),
          casualties,
          date:       item.pubDate,
          link:       item.link,
          source:     item.source,
          createdAt,
          expiresAt,
        };
        const existing = countryStories.get(zone.country);
        if (existing) {
          if (!existing.some(s => s.title === story.title)) existing.push(story);
        } else {
          countryStories.set(zone.country, [story]);
        }
        matched = true;
        break; // assign each article to the first matching zone only
      }
      // If not matched by a known conflict zone, check world countries
      if (!matched) {
        for (const wc of WORLD_COUNTRIES) {
          if (!wc.pattern.test(text)) continue;
          const story: StoryEntry = {
            title:      item.title,
            summary:    item.summary.slice(0, 300),
            casualties,
            date:       item.pubDate,
            link:       item.link,
            source:     item.source,
            createdAt,
            expiresAt,
          };
          const existing = countryStories.get(wc.country);
          if (existing) {
            if (!existing.some(s => s.title === story.title)) existing.push(story);
          } else {
            countryStories.set(wc.country, [story]);
          }
          break;
        }
      }
    }

    // Find trending country: most stories in the current 24 h window
    let trendingCountry = '';
    let trendingMax = 0;
    for (const [country, stories] of countryStories) {
      if (stories.length > trendingMax) {
        trendingMax = stories.length;
        trendingCountry = country;
      }
    }

    // Build CountryThreat[] — always include all known conflict zones
    const threats: CountryThreat[] = [];
    const addedCountries = new Set<string>();
    for (const zone of KNOWN_CONFLICT_ZONES) {
      const stories = countryStories.get(zone.country) ?? [];
      const severity = zone.defaultSeverity;
      const hasNew = stories.some(s => now - new Date(s.date).getTime() < NEW_STORY_MS);
      threats.push({ country: zone.country, severity, lat: zone.lat, lon: zone.lon, hasNew, isTrending: trendingCountry === zone.country, stories });
      addedCountries.add(zone.country);
    }

    // Also include world countries that have active stories, skipping any already added above
    for (const wc of WORLD_COUNTRIES) {
      if (addedCountries.has(wc.country)) continue;
      const stories = countryStories.get(wc.country);
      if (!stories || stories.length === 0) continue;
      const hasNew = stories.some(s => now - new Date(s.date).getTime() < NEW_STORY_MS);
      threats.push({ country: wc.country, severity: 'turbulent', lat: wc.lat, lon: wc.lon, hasNew, isTrending: trendingCountry === wc.country, stories });
    }

    // Sort: highest severity first, then most-recent story first
    threats.sort((a, b) => {
      const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sd !== 0) return sd;
      if (a.stories.length === 0 && b.stories.length === 0) return 0;
      if (a.stories.length === 0) return 1;
      if (b.stories.length === 0) return -1;
      const aLatest = Math.max(...a.stories.map(s => new Date(s.date).getTime()));
      const bLatest = Math.max(...b.stories.map(s => new Date(s.date).getTime()));
      return bLatest - aLatest;
    });

    const payload = { threats, updatedAt: new Date().toISOString() };
    _cachedResponse = payload;
    _cacheExpiresAt = now + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } });
  } catch {
    // Even if the RSS feed is unavailable, return all known conflict zones with
    // their default severities so the map always shows monitored hotspots.
    const fallbackThreats: CountryThreat[] = KNOWN_CONFLICT_ZONES.map(zone => ({
      country: zone.country,
      severity: zone.defaultSeverity,
      lat: zone.lat,
      lon: zone.lon,
      hasNew: false,
      isTrending: false,
      stories: [],
    }));
    return json(
      { threats: fallbackThreats, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
