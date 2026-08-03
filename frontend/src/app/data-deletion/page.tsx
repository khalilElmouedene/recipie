import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck, Trash2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Data Deletion Instructions | Recipe Automation Platform",
  description: "Instructions to request deletion of your Recipe Automation Platform and connected-platform data.",
};

const CONTACT_EMAIL = "kavaa.studius@gmail.com";

export default function DataDeletionPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07110f] px-5 py-8 text-white sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.17),transparent_52%)]" />

      <div className="relative mx-auto max-w-3xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <Link href="/privacy" className="group inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white">
            <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
            Privacy Policy
          </Link>
          <ShieldCheck size={20} className="text-emerald-300" />
        </header>

        <section className="py-14 sm:py-20">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-300">
            <Trash2 size={26} />
          </div>
          <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.26em] text-emerald-400">Your data, your choice</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Data deletion instructions</h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">
            You can request deletion of your Recipe Automation Platform account and the personal,
            project, and connected-platform data associated with it.
          </p>

          <div className="mt-12 space-y-4">
            {[
              {
                title: "Disconnect Facebook or another platform",
                text: "Open the relevant project's settings and remove the connected Page or account. You may also remove Recipe Automation Platform from your Facebook Apps and Websites settings.",
              },
              {
                title: "Send your deletion request",
                text: `Email ${CONTACT_EMAIL} from the email address used for your account. Use the subject “Data deletion request” and include the connected Facebook Page name when relevant.`,
              },
              {
                title: "Verification and completion",
                text: "We may verify account ownership before deletion. After verification, we will delete or anonymize eligible account, project, token, content, and publishing records, except records we must retain for legal or security reasons.",
              },
            ].map((step, index) => (
              <div key={step.title} className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-6 sm:grid-cols-[2.5rem_1fr]">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-300/10 font-mono text-sm font-bold text-emerald-300">
                  {index + 1}
                </div>
                <div>
                  <h2 className="font-semibold text-white">{step.title}</h2>
                  <p className="mt-2 text-sm leading-7 text-slate-400">{step.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <h2 className="font-semibold text-white">Send a request now</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">We will confirm receipt and provide a status or completion notice by email.</p>
                <a href={`mailto:${CONTACT_EMAIL}?subject=Data%20deletion%20request`} className="mt-4 inline-flex items-center gap-2 font-medium text-emerald-300 hover:text-emerald-200">
                  <Mail size={16} /> {CONTACT_EMAIL}
                </a>
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 py-7 text-xs text-slate-500">
          © 2026 Recipe Automation Platform · bohssini.com
        </footer>
      </div>
    </main>
  );
}
