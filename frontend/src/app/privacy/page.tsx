import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Database,
  ExternalLink,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | Recipe Automation Platform",
  description:
    "How Recipe Automation Platform collects, uses, protects, and deletes personal and social-platform data.",
};

const EFFECTIVE_DATE = "August 3, 2026";
const CONTACT_EMAIL = "kavaa.studius@gmail.com";

const sections = [
  { id: "information", label: "Information we collect" },
  { id: "use", label: "How we use data" },
  { id: "meta", label: "Facebook and Meta data" },
  { id: "sharing", label: "Sharing and processors" },
  { id: "retention", label: "Retention and deletion" },
  { id: "security", label: "Security" },
  { id: "rights", label: "Your rights" },
  { id: "contact", label: "Contact" },
];

function PolicySection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-slate-800/80 py-9 first:border-0 first:pt-0">
      <div className="mb-4 flex items-start gap-4">
        <span className="mt-0.5 font-mono text-xs font-semibold tracking-[0.22em] text-emerald-400">
          {number}
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
      </div>
      <div className="space-y-4 pl-0 text-[15px] leading-7 text-slate-300 sm:pl-10">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07110f] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_18%_12%,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_82%_2%,rgba(59,130,246,0.12),transparent_30%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.9)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
            Recipe Automation
          </Link>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Public document
          </span>
        </header>

        <div className="grid gap-12 pb-16 pt-14 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 lg:pt-20">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.12)]">
              <ShieldCheck size={24} />
            </div>
            <p className="mb-4 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              On this page
            </p>
            <nav aria-label="Privacy policy sections" className="hidden space-y-1 lg:block">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block border-l border-slate-800 py-1.5 pl-4 text-sm text-slate-400 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </aside>

          <article className="min-w-0">
            <div className="mb-12 max-w-3xl">
              <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.28em] text-emerald-400">
                Privacy &amp; data
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.06] tracking-[-0.04em] text-white sm:text-6xl">
                Your content stays yours.
                <span className="block text-slate-500">Here is how we protect it.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This Privacy Policy explains how Recipe Automation Platform, available at bohssini.com
                ("we", "us", or "our"), handles information when you create, schedule, and publish content.
              </p>
              <div className="mt-7 flex flex-wrap gap-3 text-xs text-slate-400">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Effective {EFFECTIVE_DATE}</span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Applies to bohssini.com</span>
              </div>
            </div>

            <div className="mb-12 grid gap-3 sm:grid-cols-3">
              {[
                { icon: LockKeyhole, title: "Encrypted tokens", text: "Connected-account credentials are encrypted at rest." },
                { icon: Database, title: "Purpose limited", text: "We use platform data only to provide requested features." },
                { icon: Trash2, title: "Deletion available", text: "You can disconnect services and request data deletion." },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-sm">
                  <Icon size={18} className="mb-4 text-emerald-300" />
                  <h2 className="text-sm font-semibold text-white">{title}</h2>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-[#0a1513]/85 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-10">
              <PolicySection id="information" number="01" title="Information we collect">
                <p>Depending on the features you use, we may collect:</p>
                <ul className="list-disc space-y-2 pl-5 marker:text-emerald-400">
                  <li><strong className="text-slate-100">Account data:</strong> name, email address, authentication information, and account role.</li>
                  <li><strong className="text-slate-100">Connected-platform data:</strong> account and Page identifiers, Page names, profile images, permissions, encrypted access tokens, and publishing results supplied by Facebook, Meta, Pinterest, Google, or other services you connect.</li>
                  <li><strong className="text-slate-100">Project and content data:</strong> project settings, recipes, prompts, websites, images, videos, captions, schedules, comments, and generated content.</li>
                  <li><strong className="text-slate-100">Technical data:</strong> activity logs, job status, error details, timestamps, browser/device information, and basic security records.</li>
                </ul>
              </PolicySection>

              <PolicySection id="use" number="02" title="How we use information">
                <p>We use information only when needed to operate and secure the service, including to:</p>
                <ul className="list-disc space-y-2 pl-5 marker:text-emerald-400">
                  <li>authenticate users and maintain accounts;</li>
                  <li>generate recipes, images, videos, and publishing drafts;</li>
                  <li>connect Pages and websites, publish or schedule content, and add requested comments;</li>
                  <li>display job progress, delivery results, and understandable error logs;</li>
                  <li>prevent abuse, diagnose failures, and improve reliability;</li>
                  <li>comply with legal obligations and enforce our terms.</li>
                </ul>
                <p>We do not sell personal information or connected-platform data.</p>
              </PolicySection>

              <PolicySection id="meta" number="03" title="Facebook and Meta Platform data">
                <p>
                  When you choose to connect Facebook Pages, Meta may provide the Pages you manage and
                  the permissions required to publish and manage content on your behalf. Depending on
                  the approved features, these may include <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-emerald-200">pages_show_list</code>,{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-emerald-200">pages_read_engagement</code>,{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-emerald-200">pages_manage_posts</code>, and{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-emerald-200">pages_manage_engagement</code>.
                </p>
                <p>
                  We use this data only to show your available Pages, verify the connection, publish or
                  schedule the content you select, post the first comment you configure, and report the
                  delivery result. We do not use Meta Platform data for advertising or sell it to third parties.
                </p>
                <p>
                  You can stop this access by disconnecting the Page in our settings or removing the app
                  from your Facebook account settings. Removing access stops future publishing but does not
                  automatically remove content that was already published to your Page.
                </p>
              </PolicySection>

              <PolicySection id="sharing" number="04" title="Sharing and service providers">
                <p>
                  We disclose information only to the platforms you instruct us to use and to service
                  providers needed to operate the application—for example hosting and database providers,
                  AI generation providers, media storage, email delivery, WordPress, and social networks.
                  They receive only the information required for their function and process it under their
                  own terms and privacy policies.
                </p>
                <p>
                  We may also disclose information when required by law, to protect users or the service,
                  or as part of a business transfer subject to appropriate confidentiality safeguards.
                </p>
              </PolicySection>

              <PolicySection id="retention" number="05" title="Retention and deletion">
                <p>
                  We retain account, project, publishing, and log data while your account is active and for
                  only as long as reasonably needed to provide the service, resolve disputes, maintain security,
                  or comply with law. Temporary media files may be removed after processing or successful publication.
                </p>
                <p>
                  You may disconnect a platform at any time. To request deletion of your account and associated
                  personal data, follow our public{" "}
                  <Link href="/data-deletion" className="font-semibold text-emerald-300 underline decoration-emerald-300/30 underline-offset-4 hover:text-emerald-200">
                    data deletion instructions
                  </Link>{" "}
                  or email us. We may retain limited records where legally required or necessary for fraud prevention.
                </p>
              </PolicySection>

              <PolicySection id="security" number="06" title="Security">
                <p>
                  We use reasonable technical and organizational safeguards, including access controls and
                  encryption of connected-account credentials at rest. No internet service can guarantee
                  absolute security, so you should also protect your account and immediately report suspected misuse.
                </p>
              </PolicySection>

              <PolicySection id="rights" number="07" title="Your choices and rights">
                <p>
                  Subject to applicable law, you may ask to access, correct, export, restrict, or delete your
                  personal information. You may also withdraw a connected platform&apos;s authorization at any time.
                  We may verify your identity before completing a request.
                </p>
                <p>
                  The service is not intended for children under 13, and we do not knowingly collect their personal data.
                </p>
              </PolicySection>

              <PolicySection id="changes" number="08" title="Changes to this policy">
                <p>
                  We may update this policy when the service or legal requirements change. We will publish the
                  revised policy here and update the effective date. Material changes may also be communicated in the application.
                </p>
              </PolicySection>

              <PolicySection id="contact" number="09" title="Contact us">
                <p>Questions, privacy requests, and deletion requests can be sent to:</p>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 font-medium text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-300/15"
                >
                  <Mail size={16} />
                  {CONTACT_EMAIL}
                </a>
              </PolicySection>
            </div>
          </article>
        </div>

        <footer className="flex flex-col gap-4 border-t border-white/10 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Recipe Automation Platform · bohssini.com</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/terms" className="transition hover:text-white">Terms of Service</Link>
            <Link href="/data-deletion" className="transition hover:text-white">Data Deletion</Link>
            <a href="https://bohssini.com" className="inline-flex items-center gap-1 transition hover:text-white">
              Visit application <ExternalLink size={12} />
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
