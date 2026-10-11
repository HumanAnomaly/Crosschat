import { Timer, Upload, Users } from "lucide-react";
import { useEffect } from "react";
import { getLoginUrl } from "../api";
import { webConfig } from "../config";
import { useLang, LangToggle } from "../i18n";
import { stashPairCode, takePairCodeParam } from "../pairingLink";
import { usePlatforms } from "../platforms";
import { ThemeToggle } from "../theme";
import BrandIcon from "../components/BrandIcon";
import PlatformIcon from "../components/PlatformIcon";
import { FILE_LIMIT_LABEL } from "../format";

export default function LandingPage() {
  const platforms = usePlatforms();
  const { t } = useLang();
  const pairMinutes = Math.round(webConfig.pairTtlSeconds / 60);

  const limits = [
    { icon: Timer, label: t("landing.limitCode", { n: pairMinutes }) },
    { icon: Users, label: t("landing.limitRoom") },
    { icon: Upload, label: t("landing.limitMedia", { limit: FILE_LIMIT_LABEL }) },
  ] as const;

  const steps = [
    { title: t("landing.step1t"), text: t("landing.step1x") },
    { title: t("landing.step2t"), text: t("landing.step2x", { ttl: t("common.minutes", { n: pairMinutes }) }) },
    { title: t("landing.step3t"), text: t("landing.step3x") },
  ] as const;

  // A pairing link opened before login: park the code across the OAuth trip.
  useEffect(() => {
    const code = takePairCodeParam();
    if (code) stashPairCode(code);
  }, []);

  return (
    <div className="bg-base-100 text-base-content flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-2 px-6 py-4">
        <span className="flex items-center gap-2 font-bold tracking-tight">
          <BrandIcon size={18} />
          Crosschat
        </span>
        <span className="flex-1" />
        <ThemeToggle />
        <LangToggle />
        <a className="btn btn-primary btn-sm" href={getLoginUrl()}>
          {t("landing.signIn")}
        </a>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-50">
            {t("landing.eyebrow")}
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mt-3 max-w-lg leading-relaxed opacity-70">
            {t("landing.heroSub")}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <a className="btn btn-primary btn-sm px-4" href={getLoginUrl()}>
              {t("landing.signInGoogle")}
            </a>
            <a href="#how" className="btn btn-ghost btn-sm px-3">
              {t("landing.howLinking")}
            </a>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm opacity-60">
            {limits.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <Icon size={15} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="border-t border-base-300 py-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            {t("landing.supported")}
          </h2>
          <ul className="mt-2 divide-y divide-base-300">
            {platforms.map((p) => (
              <li key={p.id} className="flex items-baseline gap-3 py-3">
                <span className="flex items-center gap-2 font-semibold">
                  <PlatformIcon platform={p} size={13} />
                  {p.label}
                </span>
                <span className="ml-auto max-w-md text-right text-sm opacity-70">{p.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="border-t border-base-300 py-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            {t("landing.howLinking")}
          </h2>
          <ol className="mt-4 space-y-4">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="font-mono text-sm opacity-40">{i + 1}.</span>
                <span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="block text-sm opacity-70">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 font-mono text-sm opacity-60">
            {t("landing.sample")}
          </p>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-2xl px-6 pb-8 pt-4">
        <p className="border-t border-base-300 pt-4 text-sm opacity-60">
          {t("landing.oss")}{" "}
          <a
            className="link"
            href="https://github.com/HumanAnomaly/Crosschat"
            target="_blank"
            rel="noreferrer"
          >
            {t("landing.source")}
          </a>
        </p>
      </footer>
    </div>
  );
}
