import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // All spal.* tokens reference CSS custom properties defined in
        // src/styles/index.css. The values resolve at runtime, so changing a
        // token in CSS updates every Tailwind class that references it.
        spal: {
          bg:               'var(--spal-bg)',
          surface:          'var(--spal-surface)',
          'surface-raised': 'var(--spal-surface-raised)',
          text:             'var(--spal-text)',
          muted:            'var(--spal-text-muted)',
          cerulean:         'var(--spal-cerulean)',
          'cerulean-light': 'var(--spal-cerulean-light)',
          yellow:           'var(--spal-yellow)',
          gold:             'var(--spal-gold)',
          error:            'var(--spal-error)',
          warning:          'var(--spal-warning)',
          success:          'var(--spal-success)',
          disabled:         'var(--spal-disabled)',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"',
          'Roboto', 'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      maxWidth: {
        spal: '1200px',
      },
    },
  },
  plugins: [],
}

export default config
