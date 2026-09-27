/**
 * UI language for the web app.
 *
 * The English string **is** the key: `t('Settings')` returns the Vietnamese
 * translation when the language is `vi`, and the string itself otherwise —
 * so a missing entry degrades to readable English instead of a raw key, and
 * adding a new string needs no key invented for it.
 *
 * This is deliberately the same contract as the desktop app's
 * `context.tr(...)` (`desktop_app/lib/core/i18n/l10n.dart`), and both read
 * the *same* dictionary: `vi.json` is generated from the desktop maps by
 * `desktop_app/tool/i18n_export.dart`. One source, so a sentence edited on
 * one client cannot leave the other showing English.
 *
 * No i18n library: with the key being the English text, one extra language,
 * and a language that does not inflect plurals, a provider and a lookup is
 * the whole requirement. A dependency here would add a bundle and a second
 * set of conventions without replacing anything.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import viRaw from './vi.json';
import viWebRaw from './vi.web.json';

export type LangCode = 'en' | 'vi';

/**
 * The shared dictionary, plus the web's own sentences.
 *
 * `vi.json` is generated and must not be hand-edited — a re-export would
 * discard the edit. Strings the web says and the desktop does not go in
 * `vi.web.json`, which wins on the rare key both define so a web-specific
 * wording is never silently replaced by the desktop's.
 */
const VI: Record<string, string> = {
  ...(viRaw as Record<string, string>),
  ...(viWebRaw as Record<string, string>),
};
const STORAGE_KEY = 'senclaw.lang';

/** The language to start in: the saved choice, else the browser's. */
export function initialLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'vi') return saved;
  } catch {
    // Private mode and blocked site data both throw here; fall through to
    // the browser's own preference rather than failing to render.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

interface LangValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  /** Translate one English UI string. */
  t: (en: string) => string;
  /** Translate a template and substitute `{name}` placeholders. */
  tArgs: (en: string, args: Record<string, unknown>) => string;
}

const LangContext = createContext<LangValue | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(initialLang);

  const setLang = useCallback((l: LangCode) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // The choice still applies to this session; it just will not persist.
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LangValue>(() => {
    const t = (en: string) => (lang === 'vi' ? VI[en] ?? en : en);
    return {
      lang,
      setLang,
      t,
      tArgs: (en, args) => {
        let s = t(en);
        for (const [k, v] of Object.entries(args)) s = s.split(`{${k}}`).join(String(v));
        return s;
      },
    };
  }, [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/**
 * Translate inside a component.
 *
 * Usable outside a provider: it falls back to English rather than throwing,
 * so a component rendered in isolation (a test, a portal) still shows text.
 */
export function useLang(): LangValue {
  const ctx = useContext(LangContext);
  if (ctx) return ctx;
  const t = (en: string) => en;
  return {
    lang: 'en',
    setLang: () => {},
    t,
    tArgs: (en, args) => {
      let s = en;
      for (const [k, v] of Object.entries(args)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
  };
}

/** How many strings the Vietnamese dictionary carries — used by the check script. */
export const VI_STRING_COUNT = Object.keys(VI).length;
