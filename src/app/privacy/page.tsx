import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/app-shell/brand-logo";
import { APP_NAME } from "@/config/app";

export const metadata: Metadata = {
  title: `Privacy statement · ${APP_NAME}`,
  description: `What ${APP_NAME} collects, why, and for how long.`,
  robots: { index: false, follow: false },
};

/**
 * A public page (it sits outside the signed-in layout): browsers, security reviewers and staff can read it without an account.
 * It is static text, so it is prerendered. Keep it in step with the code: the tables, cookies and lifetimes below are the ones in
 * prisma/schema.prisma and src/server/auth.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <BrandLogo className="h-10 self-start" />
        <h1 className="font-heading text-2xl font-semibold">Privacy statement</h1>
        <p className="text-sm text-muted-foreground">
          {APP_NAME} is the internal tool of PT Halcom Inovasi for tracking project, BOQ, RFQ and PO requests. It is for our own staff
          only: there is no public registration, and nothing on this site is collected from visitors who do not have an account.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="collected">
        <h2 id="collected" className="text-lg font-semibold">
          What is collected
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Staff accounts:</strong> name, company e-mail address and role. An administrator creates the account; people cannot
            sign themselves up.
          </li>
          <li>
            <strong>Password:</strong> stored only as a salted scrypt hash, never in plain text and never shown or sent by e-mail.
          </li>
          <li>
            <strong>Session:</strong> a random token in a cookie; only its hash is stored on the server. A session ends after 12 hours
            without use, and after 7 days at the latest.
          </li>
          <li>
            <strong>Failed sign-in counters:</strong> the e-mail that was typed and a SHA-256 hash of the network address, to slow down
            password guessing. The address itself is not stored. Failures are counted over 15 minutes, and a lock lasts 15 to 60 minutes.
          </li>
          <li>
            <strong>Audit log:</strong> who signed in or out and who changed which record, and when. It can only be added to.
          </li>
          <li>
            <strong>Business records</strong> that staff enter: customers, projects, requests, and the names of our own PICs (the
            people who handle them).
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="cookies">
        <h2 id="cookies" className="text-lg font-semibold">
          Cookies and browser storage
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Session cookie:</strong> keeps you signed in. HttpOnly, Secure, SameSite=Lax.
          </li>
          <li>
            <strong>Remembered accounts</strong> (<code>recent_accounts</code>, <code>device_accounts</code>): the name, e-mail and role
            of staff accounts used on this browser, to make switching accounts quicker (30 days at most). They hold no password, and
            each entry can be removed from the sign-in page.
          </li>
          <li>
            <strong>Theme choice:</strong> light or dark, kept in the browser&apos;s local storage.
          </li>
        </ul>
        <p className="text-sm">
          There are no analytics, no advertising and no third-party trackers or scripts on this site.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="why">
        <h2 id="why" className="text-lg font-semibold">
          Why it is collected, and who sees it
        </h2>
        <p className="text-sm">
          To sign staff in, to give each role only the access it needs, to protect accounts against password guessing, and to keep a
          trail of changes to business records. The data is used inside the company only and is not sold or shared with third parties.
          It is kept on our own server, and a copy of the database is backed up to a separate private database.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="contact">
        <h2 id="contact" className="text-lg font-semibold">
          Questions, corrections and removal
        </h2>
        <p className="text-sm">
          Staff can ask the administrator of {APP_NAME} (the Superadmin) to correct or deactivate their account. For any other
          question, including if you reached this site by mistake or believe it is wrongly flagged, write to{" "}
          <a href="mailto:support@halcominovasi.co.id" className="text-primary underline-offset-4 hover:underline">
            support@halcominovasi.co.id
          </a>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="id">
        <h2 id="id" className="text-lg font-semibold">
          Pernyataan privasi (ringkas)
        </h2>
        <p className="text-sm">
          {APP_NAME} adalah alat internal PT Halcom Inovasi untuk karyawan. Data yang disimpan: nama, email perusahaan dan peran akun;
          kata sandi hanya sebagai hash; token sesi (hanya hash); penghitung gagal login dengan hash alamat jaringan; log audit; dan
          data bisnis yang dimasukkan karyawan. Cookie hanya untuk sesi, akun yang diingat di browser, dan pilihan tema. Tidak ada
          analitik, iklan, atau pelacak pihak ketiga, dan data tidak dibagikan ke luar perusahaan. Pertanyaan: support@halcominovasi.co.id.
        </p>
      </section>

      <footer>
        <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </footer>
    </main>
  );
}
