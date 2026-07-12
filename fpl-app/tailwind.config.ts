import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fpl: {
          bg:               'var(--fpl-bg)',
          surface:          'var(--fpl-surface)',
          'surface-raised': 'var(--fpl-surface-raised)',
          text:             'var(--fpl-text)',
          muted:            'var(--fpl-muted)',
          accent:           'var(--fpl-accent)',
          'accent-light':   'var(--fpl-accent-light)',
          gold:             'var(--fpl-gold)',
          error:            'var(--fpl-error)',
          success:          'var(--fpl-success)',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"',
          'Roboto', 'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      maxWidth: {
        fpl: '1200px',
      },
    },
  },
  plugins: [],
}

export default config
