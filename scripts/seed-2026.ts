/**
 * scripts/seed-2026.ts
 *
 * Seeds the 2026 historical season with real data extracted from the
 * 2026 Sergio Parisse Appreciation League spreadsheet.
 *
 * Prerequisites:
 *   - Season ID 1 exists in the database (status: 'historical')
 *   - spal-app/.env.local contains VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Run from the spal-app directory:
 *   cd spal-app && npx tsx ../scripts/seed-2026.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY: This script uses the Supabase SERVICE ROLE KEY, which bypasses
 * Row Level Security entirely. It must ONLY be used in server-side scripts
 * like this one. NEVER import the service role key into frontend/browser
 * code — doing so would expose it to every user of the site.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Env loading ──────────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf8')
    const env: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
    }
    return env
  } catch {
    return {}
  }
}

const env = loadEnvFile(join(process.cwd(), '.env.local'))

const SUPABASE_URL = env['VITE_SUPABASE_URL'] ?? process.env['SUPABASE_URL']
const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (SUPABASE_URL.includes('your-project') || SERVICE_ROLE_KEY.includes('your-service-role')) {
  console.error('Placeholder values detected in .env.local — fill in real credentials first')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Constants ────────────────────────────────────────────────────────────────

const SEASON_ID = 1
const NICO_EMAIL = 'spinach91@hotmail.com'

// ─── Position group map ───────────────────────────────────────────────────────

const POSITION_GROUP: Record<string, string> = {
  'Prop':       'Front Row',
  'Hooker':     'Front Row',
  'Second Row': 'Other',
  'Flanker':    'Back Row',
  'Number 8':   'Back Row',
  'Scrum-half': 'Other',
  'Fly-half':   'Other',
  'Centre':     'Other',
  'Wing':       'Outside Back',
  'Fullback':   'Outside Back',
}

// ─── Manager definitions ──────────────────────────────────────────────────────
//
// Draft order matches the spreadsheet column order (left to right).
// Nico (pick 6) links to the existing auth account spinach91@hotmail.com.
// The other six receive placeholder auth accounts with @spal.placeholder
// emails — these can be claimed later when each manager signs up.

type ManagerDef = {
  name: string
  email: string
  pickPosition: number
  isNico: boolean
}

const MANAGERS: ManagerDef[] = [
  { name: 'Gman',    email: 'gman@spal.placeholder',    pickPosition: 1, isNico: false },
  { name: 'Chris',   email: 'chris@spal.placeholder',   pickPosition: 2, isNico: false },
  { name: 'TFK',     email: 'tfk@spal.placeholder',     pickPosition: 3, isNico: false },
  { name: 'Jonners', email: 'jonners@spal.placeholder', pickPosition: 4, isNico: false },
  { name: 'Tommy T', email: 'tommyt@spal.placeholder',  pickPosition: 5, isNico: false },
  { name: 'Nico',    email: NICO_EMAIL,                 pickPosition: 6, isNico: true  },
  { name: 'Laura',   email: 'laura@spal.placeholder',   pickPosition: 7, isNico: false },
]

// ─── Player definitions ───────────────────────────────────────────────────────
//
// All unique starting XV players from the 2026 Six Nations W1-W3, plus
// bench players who appear in the draft picks.
// Source: '2026 Squads', '2026 W2', and '2026 W3' sheets in the spreadsheet.
//
// canonical_position uses SPAL values:
//   Prop | Hooker | Second Row | Flanker | Number 8
//   Scrum-half | Fly-half | Centre | Wing | Fullback

type PlayerDef = {
  display_name: string
  nation: 'England' | 'Ireland' | 'Scotland' | 'Wales' | 'France' | 'Italy'
  canonical_position: string
  note?: string
}

const PLAYERS: PlayerDef[] = [
  // ── France W1 starters ────────────────────────────────────────────────────
  { display_name: 'Thomas Ramos',          nation: 'France',   canonical_position: 'Fullback'   },
  { display_name: 'Theo Attissogbe',       nation: 'France',   canonical_position: 'Wing'       },
  { display_name: 'Nicolas Depoortere',    nation: 'France',   canonical_position: 'Centre'     },
  { display_name: 'Yoram Moefana',         nation: 'France',   canonical_position: 'Centre'     },
  { display_name: 'Louis Bielle-Biarrey',  nation: 'France',   canonical_position: 'Wing'       },
  { display_name: 'Matthieu Jalibert',     nation: 'France',   canonical_position: 'Fly-half'   },
  { display_name: 'Antoine Dupont',        nation: 'France',   canonical_position: 'Scrum-half' },
  { display_name: 'Jean-Baptiste Gros',    nation: 'France',   canonical_position: 'Prop'       },
  { display_name: 'Julien Marchand',       nation: 'France',   canonical_position: 'Hooker'     },
  { display_name: 'Dorian Aldegheri',      nation: 'France',   canonical_position: 'Prop'       },
  // Ollivon: wears #4 (Second Row jersey) in all starting XVs but the
  // fantasy game classifies him as Back Row. Using Flanker to keep the
  // draft pick data consistent (drafted via the Back Row slot).
  { display_name: 'Charles Ollivon',       nation: 'France',   canonical_position: 'Flanker',   note: 'Wears #4; fantasy-classified as Back Row' },
  { display_name: 'Mickael Guillard',      nation: 'France',   canonical_position: 'Second Row' },
  { display_name: 'Francois Cros',         nation: 'France',   canonical_position: 'Flanker'    },
  { display_name: 'Oscar Jegou',           nation: 'France',   canonical_position: 'Flanker'    },
  { display_name: 'Anthony Jelonch',       nation: 'France',   canonical_position: 'Number 8'   },

  // ── France bench — drafted only ───────────────────────────────────────────
  { display_name: 'Cyril Baille',          nation: 'France',   canonical_position: 'Prop'       },

  // ── France W2/W3 new starters ─────────────────────────────────────────────
  { display_name: 'Emilien Gailleton',     nation: 'France',   canonical_position: 'Centre'     },
  { display_name: 'Fabien Brau-Boirie',    nation: 'France',   canonical_position: 'Centre'     },
  { display_name: 'Thibaud Flament',       nation: 'France',   canonical_position: 'Second Row' },
  { display_name: 'Emmanuel Meafou',       nation: 'France',   canonical_position: 'Second Row' },

  // ── Ireland W1 starters ───────────────────────────────────────────────────
  { display_name: 'Jamie Osborne',         nation: 'Ireland',  canonical_position: 'Fullback'   },
  { display_name: "Tommy O'Brien",         nation: 'Ireland',  canonical_position: 'Wing'       },
  { display_name: 'Garry Ringrose',        nation: 'Ireland',  canonical_position: 'Centre'     },
  { display_name: 'Stuart McCloskey',      nation: 'Ireland',  canonical_position: 'Centre'     },
  { display_name: 'Jacob Stockdale',       nation: 'Ireland',  canonical_position: 'Wing'       },
  { display_name: 'Sam Prendergast',       nation: 'Ireland',  canonical_position: 'Fly-half'   },
  { display_name: 'Jamison Gibson-Park',   nation: 'Ireland',  canonical_position: 'Scrum-half' },
  { display_name: 'Jeremy Loughman',       nation: 'Ireland',  canonical_position: 'Prop'       },
  { display_name: 'Dan Sheehan',           nation: 'Ireland',  canonical_position: 'Hooker'     },
  { display_name: 'Thomas Clarkson',       nation: 'Ireland',  canonical_position: 'Prop'       },
  { display_name: 'Joe McCarthy',          nation: 'Ireland',  canonical_position: 'Second Row' },
  { display_name: 'Tadhg Beirne',          nation: 'Ireland',  canonical_position: 'Second Row' },
  { display_name: 'Cian Prendergast',      nation: 'Ireland',  canonical_position: 'Flanker'    },
  { display_name: 'Josh van der Flier',    nation: 'Ireland',  canonical_position: 'Flanker'    },
  { display_name: 'Caelan Doris',          nation: 'Ireland',  canonical_position: 'Number 8'   },

  // ── Ireland W2/W3 new starters ────────────────────────────────────────────
  { display_name: 'Robert Baloucoune',     nation: 'Ireland',  canonical_position: 'Wing'       },
  { display_name: 'James Lowe',            nation: 'Ireland',  canonical_position: 'Wing'       },
  { display_name: 'Jack Crowley',          nation: 'Ireland',  canonical_position: 'Fly-half'   },
  { display_name: 'Craig Casey',           nation: 'Ireland',  canonical_position: 'Scrum-half' },
  { display_name: 'Tadhg Furlong',         nation: 'Ireland',  canonical_position: 'Prop'       },
  { display_name: 'James Ryan',            nation: 'Ireland',  canonical_position: 'Second Row' },
  { display_name: 'Cormac Izuchukwu',      nation: 'Ireland',  canonical_position: 'Flanker'    },
  { display_name: 'Jack Conan',            nation: 'Ireland',  canonical_position: 'Number 8'   },

  // ── England W1 starters ───────────────────────────────────────────────────
  { display_name: 'Freddie Steward',       nation: 'England',  canonical_position: 'Fullback'   },
  { display_name: 'Immanuel Feyi-Waboso',  nation: 'England',  canonical_position: 'Wing'       },
  // Freeman: wears #13 (Centre) in W1/W2 but is fantasy-classified as Outside
  // Back and drafted via the Outside Back slot. Using Wing.
  { display_name: 'Tommy Freeman',         nation: 'England',  canonical_position: 'Wing',      note: 'Wears #13 in W1/W2; fantasy OB; drafted via Outside Back slot' },
  { display_name: 'Fraser Dingwall',       nation: 'England',  canonical_position: 'Centre'     },
  { display_name: 'Henry Arundell',        nation: 'England',  canonical_position: 'Wing'       },
  { display_name: 'George Ford',           nation: 'England',  canonical_position: 'Fly-half'   },
  { display_name: 'Alex Mitchell',         nation: 'England',  canonical_position: 'Scrum-half' },
  { display_name: 'Ellis Genge',           nation: 'England',  canonical_position: 'Prop'       },
  { display_name: 'Jamie George',          nation: 'England',  canonical_position: 'Hooker'     },
  { display_name: 'Joe Heyes',             nation: 'England',  canonical_position: 'Prop'       },
  { display_name: 'Alex Coles',            nation: 'England',  canonical_position: 'Second Row' },
  { display_name: 'Ollie Chessum',         nation: 'England',  canonical_position: 'Second Row' },
  { display_name: 'Guy Pepper',            nation: 'England',  canonical_position: 'Flanker'    },
  { display_name: 'Sam Underhill',         nation: 'England',  canonical_position: 'Flanker'    },
  { display_name: 'Ben Earl',              nation: 'England',  canonical_position: 'Number 8'   },

  // ── England W2/W3 new starters ────────────────────────────────────────────
  { display_name: 'Tom Roebuck',           nation: 'England',  canonical_position: 'Wing'       },
  { display_name: 'Ollie Lawrence',        nation: 'England',  canonical_position: 'Centre'     },
  { display_name: 'Luke Cowan-Dickie',     nation: 'England',  canonical_position: 'Hooker'     },
  { display_name: 'Maro Itoje',            nation: 'England',  canonical_position: 'Second Row' },
  { display_name: 'Tom Curry',             nation: 'England',  canonical_position: 'Flanker'    },
  // Pollock: replacement in W1/W2, starting N8 in W3; drafted by Gman.
  { display_name: 'Henry Pollock',         nation: 'England',  canonical_position: 'Number 8'   },

  // ── Italy W1 starters ─────────────────────────────────────────────────────
  { display_name: 'Leonardo Marin',        nation: 'Italy',    canonical_position: 'Fullback'   },
  { display_name: 'Louis Lynagh',          nation: 'Italy',    canonical_position: 'Wing'       },
  { display_name: 'Juan Ignacio Brex',     nation: 'Italy',    canonical_position: 'Centre'     },
  { display_name: 'Tommaso Menoncello',    nation: 'Italy',    canonical_position: 'Centre'     },
  { display_name: 'Monty Ioane',           nation: 'Italy',    canonical_position: 'Wing'       },
  { display_name: 'Paolo Garbisi',         nation: 'Italy',    canonical_position: 'Fly-half'   },
  { display_name: 'Alessandro Fusco',      nation: 'Italy',    canonical_position: 'Scrum-half' },
  { display_name: 'Danilo Fischetti',      nation: 'Italy',    canonical_position: 'Prop'       },
  { display_name: 'Giacomo Nicotera',      nation: 'Italy',    canonical_position: 'Hooker'     },
  { display_name: 'Simone Ferrari',        nation: 'Italy',    canonical_position: 'Prop'       },
  { display_name: 'Niccolo Cannone',       nation: 'Italy',    canonical_position: 'Second Row' },
  { display_name: 'Andrea Zambonin',       nation: 'Italy',    canonical_position: 'Second Row' },
  { display_name: 'Michele Lamaro',        nation: 'Italy',    canonical_position: 'Flanker'    },
  { display_name: 'Manuel Zuliani',        nation: 'Italy',    canonical_position: 'Flanker'    },
  { display_name: 'Lorenzo Cannone',       nation: 'Italy',    canonical_position: 'Number 8'   },

  // ── Italy W2 new starters ─────────────────────────────────────────────────
  { display_name: 'Lorenzo Pani',          nation: 'Italy',    canonical_position: 'Fullback'   },

  // ── Scotland W1 starters ──────────────────────────────────────────────────
  { display_name: 'Tom Jordan',            nation: 'Scotland', canonical_position: 'Fullback'   },
  { display_name: 'Kyle Steyn',            nation: 'Scotland', canonical_position: 'Wing'       },
  { display_name: 'Huw Jones',             nation: 'Scotland', canonical_position: 'Centre'     },
  { display_name: 'Sione Tuipulotu',       nation: 'Scotland', canonical_position: 'Centre'     },
  { display_name: 'Jamie Dobie',           nation: 'Scotland', canonical_position: 'Wing'       },
  { display_name: 'Finn Russell',          nation: 'Scotland', canonical_position: 'Fly-half'   },
  { display_name: 'Ben White',             nation: 'Scotland', canonical_position: 'Scrum-half' },
  { display_name: 'Pierre Schoeman',       nation: 'Scotland', canonical_position: 'Prop'       },
  { display_name: 'Ewan Ashman',           nation: 'Scotland', canonical_position: 'Hooker'     },
  { display_name: 'Zander Fagerson',       nation: 'Scotland', canonical_position: 'Prop'       },
  { display_name: 'Scott Cummings',        nation: 'Scotland', canonical_position: 'Second Row' },
  { display_name: 'Grant Gilchrist',       nation: 'Scotland', canonical_position: 'Second Row' },
  { display_name: 'Matt Fagerson',         nation: 'Scotland', canonical_position: 'Flanker'    },
  { display_name: 'Rory Darge',            nation: 'Scotland', canonical_position: 'Flanker'    },
  { display_name: 'Jack Dempsey',          nation: 'Scotland', canonical_position: 'Number 8'   },

  // ── Scotland W2/W3 new starters ───────────────────────────────────────────
  { display_name: 'Blair Kinghorn',        nation: 'Scotland', canonical_position: 'Fullback'   },
  { display_name: 'Duhan van der Merwe',   nation: 'Scotland', canonical_position: 'Wing'       },
  { display_name: 'Nathan McBeth',         nation: 'Scotland', canonical_position: 'Prop'       },
  { display_name: 'George Turner',         nation: 'Scotland', canonical_position: 'Hooker'     },
  { display_name: 'Dave Cherry',           nation: 'Scotland', canonical_position: 'Hooker'     },
  { display_name: 'Max Williamson',        nation: 'Scotland', canonical_position: 'Second Row' },
  { display_name: 'Gregor Brown',          nation: 'Scotland', canonical_position: 'Second Row' },
  { display_name: 'Jamie Ritchie',         nation: 'Scotland', canonical_position: 'Flanker'    },

  // ── Wales W1 starters (derived from W1 stats sheet, no starting XV in spreadsheet) ──
  { display_name: 'Louis Rees-Zammit',     nation: 'Wales',    canonical_position: 'Fullback'   },
  { display_name: 'Ellis Mee',             nation: 'Wales',    canonical_position: 'Wing'       },
  { display_name: 'Josh Adams',            nation: 'Wales',    canonical_position: 'Wing'       },
  { display_name: 'Eddie James',           nation: 'Wales',    canonical_position: 'Centre'     },
  { display_name: 'Blair Thomas',          nation: 'Wales',    canonical_position: 'Centre'     },
  { display_name: 'Dan Edwards',           nation: 'Wales',    canonical_position: 'Fly-half'   },
  { display_name: 'Tomos Williams',        nation: 'Wales',    canonical_position: 'Scrum-half' },
  { display_name: 'Archie Griffin',        nation: 'Wales',    canonical_position: 'Prop'       },
  { display_name: 'Nicky Smith',           nation: 'Wales',    canonical_position: 'Prop'       },
  { display_name: 'Dewi Lake',             nation: 'Wales',    canonical_position: 'Hooker'     },
  { display_name: 'Dafydd Jenkins',        nation: 'Wales',    canonical_position: 'Second Row' },
  { display_name: 'Adam Beard',            nation: 'Wales',    canonical_position: 'Second Row' },
  { display_name: 'Josh Macleod',           nation: 'Wales',    canonical_position: 'Flanker'    },
  { display_name: 'Aaron Wainwright',      nation: 'Wales',    canonical_position: 'Flanker'    },

  // ── Wales W2/W3 new starters ──────────────────────────────────────────────
  { display_name: 'Joe Hawkins',           nation: 'Wales',    canonical_position: 'Centre'     },
  { display_name: 'Sam Costelow',          nation: 'Wales',    canonical_position: 'Fly-half'   },
  { display_name: 'Rhys Carre',            nation: 'Wales',    canonical_position: 'Prop'       },
  { display_name: 'Tomas Francis',         nation: 'Wales',    canonical_position: 'Prop'       },
  { display_name: 'Ben Carter',            nation: 'Wales',    canonical_position: 'Second Row' },
  { display_name: 'Gabriel Hamer-Webb',    nation: 'Wales',    canonical_position: 'Wing'       },
  { display_name: 'Taine Plumtree',        nation: 'Wales',    canonical_position: 'Flanker'    },
  { display_name: 'Alex Mann',             nation: 'Wales',    canonical_position: 'Flanker'    },
  { display_name: 'Olly Cracknell',        nation: 'Wales',    canonical_position: 'Number 8'   },

  // ── Wales — drafted only (not seen in W1–W3 starting XVs) ────────────────
  // George Thomas: confirmed as Nico's Wales draft pick ('G Thomas' in spreadsheet).
  // In the squad but did not feature in rounds 1–3. Also Jonners' Wales pick
  // in 2025, confirming continuity. Position: Flanker.
  { display_name: 'George Thomas',         nation: 'Wales',    canonical_position: 'Flanker'    },
]

// ─── Draft picks ──────────────────────────────────────────────────────────────
//
// 28 picks: 7 managers × 4 rounds (linear draft, same order each round).
// draft_slot values: 'Front Row' | 'Back Row' | 'Outside Back' | 'Wales' | 'Bench Sub'
//
// pick_number is sequential across the whole draft (not per-manager per-round).
// Round 1 = picks 1–7, Round 2 = picks 8–14, Round 3 = 15–21, Round 4 = 22–28.

type DraftPickDef = {
  pickNumber: number
  managerName: string
  playerName: string   // must match display_name in PLAYERS exactly
  draftSlot: string
}

const DRAFT_PICKS: DraftPickDef[] = [
  // ── Round 1 — everyone picks Outside Back ─────────────────────────────────
  { pickNumber: 1,  managerName: 'Gman',    playerName: 'Immanuel Feyi-Waboso',  draftSlot: 'Outside Back' },
  { pickNumber: 2,  managerName: 'Chris',   playerName: 'Louis Bielle-Biarrey',  draftSlot: 'Outside Back' },
  { pickNumber: 3,  managerName: 'TFK',     playerName: 'Thomas Ramos',          draftSlot: 'Outside Back' },
  { pickNumber: 4,  managerName: 'Jonners', playerName: 'Theo Attissogbe',       draftSlot: 'Outside Back' },
  { pickNumber: 5,  managerName: 'Tommy T', playerName: 'Freddie Steward',       draftSlot: 'Outside Back' },
  { pickNumber: 6,  managerName: 'Nico',    playerName: 'Tommy Freeman',         draftSlot: 'Outside Back' },
  { pickNumber: 7,  managerName: 'Laura',   playerName: 'Jacob Stockdale',       draftSlot: 'Outside Back' },

  // ── Round 2 — mixed slots ─────────────────────────────────────────────────
  { pickNumber: 8,  managerName: 'Gman',    playerName: 'Dorian Aldegheri',      draftSlot: 'Front Row'    },
  { pickNumber: 9,  managerName: 'Chris',   playerName: 'Louis Rees-Zammit',     draftSlot: 'Wales'        },
  { pickNumber: 10, managerName: 'TFK',     playerName: 'Anthony Jelonch',       draftSlot: 'Back Row'     },
  { pickNumber: 11, managerName: 'Jonners', playerName: 'Caelan Doris',          draftSlot: 'Back Row'     },
  { pickNumber: 12, managerName: 'Tommy T', playerName: 'Charles Ollivon',       draftSlot: 'Back Row'     },
  { pickNumber: 13, managerName: 'Nico',    playerName: 'Ben Earl',              draftSlot: 'Back Row'     },
  { pickNumber: 14, managerName: 'Laura',   playerName: 'Sam Underhill',         draftSlot: 'Back Row'     },

  // ── Round 3 — mixed slots ─────────────────────────────────────────────────
  { pickNumber: 15, managerName: 'Gman',    playerName: 'Henry Pollock',         draftSlot: 'Back Row'     },
  { pickNumber: 16, managerName: 'Chris',   playerName: 'Francois Cros',         draftSlot: 'Back Row'     },
  { pickNumber: 17, managerName: 'TFK',     playerName: 'Joe Heyes',             draftSlot: 'Front Row'    },
  { pickNumber: 18, managerName: 'Jonners', playerName: 'Ellis Genge',           draftSlot: 'Front Row'    },
  { pickNumber: 19, managerName: 'Tommy T', playerName: 'Jean-Baptiste Gros',    draftSlot: 'Front Row'    },
  { pickNumber: 20, managerName: 'Nico',    playerName: 'Zander Fagerson',       draftSlot: 'Front Row'    },
  { pickNumber: 21, managerName: 'Laura',   playerName: 'Pierre Schoeman',       draftSlot: 'Front Row'    },

  // ── Round 4 — mostly Wales, Chris fills his Front Row slot ───────────────
  { pickNumber: 22, managerName: 'Gman',    playerName: 'Aaron Wainwright',      draftSlot: 'Wales'        },
  { pickNumber: 23, managerName: 'Chris',   playerName: 'Cyril Baille',          draftSlot: 'Front Row'    },
  { pickNumber: 24, managerName: 'TFK',     playerName: 'Nicky Smith',           draftSlot: 'Wales'        },
  { pickNumber: 25, managerName: 'Jonners', playerName: 'Dafydd Jenkins',        draftSlot: 'Wales'        },
  { pickNumber: 26, managerName: 'Tommy T', playerName: 'Adam Beard',            draftSlot: 'Wales'        },
  { pickNumber: 27, managerName: 'Nico',    playerName: 'George Thomas',         draftSlot: 'Wales'        },
  { pickNumber: 28, managerName: 'Laura',   playerName: 'Alex Mann',             draftSlot: 'Wales'        },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSearchName(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9 ]/g, '')
}

function abort(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

// ─── Step 1 — Look up Nico's existing profile ─────────────────────────────────

async function getNicoProfileId(): Promise<string> {
  console.log(`Looking up existing profile for ${NICO_EMAIL}…`)
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) abort(`listUsers failed: ${error.message}`)

  const nicoUser = data.users.find(u => u.email === NICO_EMAIL)
  if (!nicoUser) abort(`No auth user found for ${NICO_EMAIL} — has Nico signed up yet?`)

  console.log(`  ✓ Nico profile UUID: ${nicoUser.id}`)
  return nicoUser.id
}

// ─── Step 2 — Create placeholder profiles for the other 6 managers ───────────

async function ensurePlaceholderProfiles(
  nicoId: string
): Promise<Record<string, string>> {
  const profileIdByName: Record<string, string> = {}
  profileIdByName['Nico'] = nicoId

  for (const mgr of MANAGERS) {
    if (mgr.isNico) continue

    console.log(`Creating placeholder account for ${mgr.name} (${mgr.email})…`)

    // Check if account already exists to make the script re-runnable
    const existingList = await supabase.auth.admin.listUsers()
    const existing = existingList.data.users.find(u => u.email === mgr.email)
    if (existing) {
      console.log(`  ↳ already exists, skipping create`)
      profileIdByName[mgr.name] = existing.id
      continue
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: mgr.email,
      password: crypto.randomUUID(),       // random, unguessable, never shared
      email_confirm: true,                 // no confirmation email sent
      user_metadata: { display_name: mgr.name },
    })
    if (error) abort(`createUser for ${mgr.name} failed: ${error.message}`)

    profileIdByName[mgr.name] = data.user.id
    console.log(`  ✓ created: ${data.user.id}`)
  }

  return profileIdByName
}

// ─── Step 3 — Insert players ─────────────────────────────────────────────────

async function insertPlayers(): Promise<Record<string, number>> {
  console.log(`\nInserting ${PLAYERS.length} players for season ${SEASON_ID}…`)

  const playerIdByName: Record<string, number> = {}

  // Fetch already-inserted players so the script is re-runnable
  const { data: existing } = await supabase
    .from('players')
    .select('id, display_name')
    .eq('season_id', SEASON_ID)

  for (const p of (existing ?? [])) {
    playerIdByName[p.display_name] = p.id
  }

  const toInsert = PLAYERS.filter(p => !(p.display_name in playerIdByName))
  if (toInsert.length === 0) {
    console.log('  ↳ all players already exist, skipping inserts')
    return playerIdByName
  }

  const rows = toInsert.map(p => ({
    season_id:          SEASON_ID,
    display_name:       p.display_name,
    search_name:        toSearchName(p.display_name),
    nation:             p.nation,
    canonical_position: p.canonical_position,
    position_group:     POSITION_GROUP[p.canonical_position] ?? 'Other',
  }))

  const { data, error } = await supabase
    .from('players')
    .insert(rows)
    .select('id, display_name')

  if (error) abort(`player insert failed: ${error.message}`)

  for (const p of (data ?? [])) {
    playerIdByName[p.display_name] = p.id
  }

  console.log(`  ✓ inserted ${toInsert.length} players`)
  return playerIdByName
}

// ─── Step 4 — Insert draft session ───────────────────────────────────────────

async function ensureDraftSession(): Promise<void> {
  console.log('\nEnsuring draft session exists…')
  const { data: existing } = await supabase
    .from('draft_sessions')
    .select('id')
    .eq('season_id', SEASON_ID)
    .maybeSingle()

  if (existing) {
    console.log('  ↳ already exists, skipping')
    return
  }

  const { error } = await supabase.from('draft_sessions').insert({
    season_id:    SEASON_ID,
    status:       'complete',
    completed_at: new Date('2026-01-30').toISOString(), // approximate pre-season draft date
  })
  if (error) abort(`draft_sessions insert failed: ${error.message}`)
  console.log('  ✓ draft session created')
}

// ─── Step 5 — Insert draft order ─────────────────────────────────────────────

async function insertDraftOrder(profileIdByName: Record<string, string>): Promise<void> {
  console.log('\nInserting draft order…')
  const { data: existing } = await supabase
    .from('draft_order')
    .select('id')
    .eq('season_id', SEASON_ID)

  if ((existing?.length ?? 0) > 0) {
    console.log('  ↳ already exists, skipping')
    return
  }

  const rows = MANAGERS.map(mgr => ({
    season_id:     SEASON_ID,
    profile_id:    profileIdByName[mgr.name],
    pick_position: mgr.pickPosition,
  }))

  const { error } = await supabase.from('draft_order').insert(rows)
  if (error) abort(`draft_order insert failed: ${error.message}`)
  console.log(`  ✓ ${rows.length} draft order rows inserted`)
}

// ─── Step 6 — Insert draft picks ─────────────────────────────────────────────

async function insertDraftPicks(
  profileIdByName: Record<string, string>,
  playerIdByName:  Record<string, number>
): Promise<void> {
  console.log('\nInserting draft picks…')
  const { data: existing } = await supabase
    .from('draft_picks')
    .select('id')
    .eq('season_id', SEASON_ID)

  if ((existing?.length ?? 0) > 0) {
    console.log('  ↳ already exists, skipping')
    return
  }

  const rows = DRAFT_PICKS.map(pick => {
    const profileId = profileIdByName[pick.managerName]
    if (!profileId) abort(`No profile found for manager "${pick.managerName}"`)

    const playerId = playerIdByName[pick.playerName]
    if (!playerId) abort(`No player found for name "${pick.playerName}" — check display_name matches exactly`)

    return {
      season_id:   SEASON_ID,
      profile_id:  profileId,
      player_id:   playerId,
      pick_number: pick.pickNumber,
      draft_slot:  pick.draftSlot,
    }
  })

  const { error } = await supabase.from('draft_picks').insert(rows)
  if (error) abort(`draft_picks insert failed: ${error.message}`)
  console.log(`  ✓ ${rows.length} draft picks inserted`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== SPAL 2026 seed script ===\n')
  console.log(`Target: season_id=${SEASON_ID}, Supabase project ${SUPABASE_URL}\n`)

  const nicoId          = await getNicoProfileId()
  const profileIdByName = await ensurePlaceholderProfiles(nicoId)
  const playerIdByName  = await insertPlayers()

  await ensureDraftSession()
  await insertDraftOrder(profileIdByName)
  await insertDraftPicks(profileIdByName, playerIdByName)

  console.log('\n✓ Seed complete.')
  console.log('\nReminders:')
  console.log('  • Placeholder managers (Gman, Chris, TFK, Jonners, Tommy T, Laura) use')
  console.log('    @spal.placeholder emails. Update each email via Supabase Auth when they sign up.')
  console.log('  • The 2026 season is inserted as "historical" — update status as needed.')
}

main().catch(err => {
  console.error('\nUnhandled error:', err)
  process.exit(1)
})
