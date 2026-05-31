export const POSITION_GROUP: Record<string, string> = {
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

export const CANONICAL_POSITIONS = [
  'Prop', 'Hooker', 'Second Row', 'Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback',
] as const

export const NATIONS = [
  'England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy',
] as const
