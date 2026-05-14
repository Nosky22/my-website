const NATIONS: Record<string, { bg: string; abbr: string }> = {
  England:  { bg: '#CC0000', abbr: 'ENG' },
  Ireland:  { bg: '#169B62', abbr: 'IRE' },
  Scotland: { bg: '#003F87', abbr: 'SCO' },
  Wales:    { bg: '#C8102E', abbr: 'WAL' },
  France:   { bg: '#002395', abbr: 'FRA' },
  Italy:    { bg: '#0066CC', abbr: 'ITA' },
}

export default function NationBadge({ nation }: { nation: string }) {
  const cfg = NATIONS[nation]
  if (!cfg) return <span className="text-spal-muted text-xs">{nation}</span>
  return (
    <span
      className="inline-block text-xs font-bold text-white rounded px-1.5 py-0.5"
      style={{ backgroundColor: cfg.bg }}
    >
      {cfg.abbr}
    </span>
  )
}
