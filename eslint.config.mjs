import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  { ignores: ['node_modules/**', '.netlify/**', 'docs/**', '**/*.min.js', 'test/**'] },
  {
    // Frontend: script globali via <script defer>, non moduli
    files: ['js/**/*.js', 'config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        supabase: 'readonly',   // CDN @supabase/supabase-js
        Stripe: 'readonly',     // CDN Stripe.js
        L: 'readonly',          // CDN Leaflet
        sb: 'writable',         // client condiviso (supabase-client.js)
        I18N: 'writable',       // i18n.js
        CONFIG: 'readonly',     // config.js
      },
    },
    rules: {
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Netlify Functions + build plugins: Node commonjs (incl. pagamenti Stripe)
    files: ['netlify/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, fetch: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
