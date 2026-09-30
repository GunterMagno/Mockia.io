import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { DEFAULT_LOCALE, I18nProvider, detectLocale, htmlLangOf, loadMessages, type Locale } from './i18n/I18nProvider';
import en, { type Messages } from './i18n/locales/en';
import './styles/tokens.scss';
import './styles/reset.scss';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const render = (locale: Locale, messages: Messages) =>
  root.render(
    <React.StrictMode>
      <I18nProvider initialLocale={locale} initialMessages={messages}>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );

// El diccionario del idioma detectado se carga antes del primer render: sin parpadeo de texto en ingles
const locale = detectLocale();
document.documentElement.lang = htmlLangOf(locale);
loadMessages(locale)
  .then((messages) => render(locale, messages))
  .catch(() => render(DEFAULT_LOCALE, en));
