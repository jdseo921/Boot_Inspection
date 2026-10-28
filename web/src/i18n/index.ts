import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./en";
import ko from "./ko";

export const LANGUAGES = [
  { code: "en", label: "English", locale: "en-US" },
  { code: "ko", label: "한국어", locale: "ko-KR" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "boot-inspection.language";

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React escapes
});

function syncDocument(lng: string) {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
syncDocument(i18n.language);
i18n.on("languageChanged", syncDocument);

export function setLanguage(lng: Language): void {
  void i18n.changeLanguage(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // not remembered; the choice still applies to this visit
  }
}

/** BCP 47 locale for Intl formatting in the current language. */
export function useLocale(): string {
  const { i18n: inst } = useTranslation();
  return LANGUAGES.find((l) => l.code === inst.language)?.locale ?? "en-US";
}

export default i18n;
