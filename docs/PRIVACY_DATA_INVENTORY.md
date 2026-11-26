# Personal data inventory: Halcom Dashboard

Dibuat dari pembacaan kode (2026-11-26). Ini catatan teknis tentang apa yang aplikasi simpan dan kirim, bukan nasihat hukum: kewajiban (misalnya UU PDP) dinilai oleh bagian hukum atau pejabat pelindungan data perusahaan. Perbarui berkas ini setiap kali ada kolom, cookie, atau layanan pihak ketiga baru.

Aplikasi adalah alat internal. Tidak ada pendaftaran publik: semua akun dibuat oleh Admin atau Superadmin untuk karyawan.

## 1. Data pribadi yang disimpan

| Data | Siapa | Tabel atau tempat | Tujuan | Catatan |
|---|---|---|---|---|
| Nama, email kerja, peran | Karyawan | `users` | Masuk, hak akses, nama di riwayat | Email disimpan huruf kecil. Awalan kode request diambil dari huruf email. |
| Hash kata sandi (scrypt) | Karyawan | `users.password_hash` | Autentikasi | Kata sandi tidak disimpan polos. |
| Token sesi (hash saja), waktu dibuat dan kedaluwarsa | Karyawan | `sessions` | Menjaga login (12 jam tidak aktif, maksimal 7 hari) | Tidak menyimpan IP atau user agent. |
| Perangkat yang diingat (hash token berbumbu, waktu pakai terakhir) | Karyawan (bukan Admin dan Superadmin) | `device_credentials` | Ganti akun tanpa mengetik ulang kata sandi | Kedaluwarsa dan bisa dihapus dari halaman login. |
| Percobaan login gagal: email yang diketik dan IP (SHA-256) | Siapa pun yang mencoba masuk | `login_attempts` | Membatasi tebakan kata sandi | Baris dihapus saat login berhasil. Email yang diketik disimpan apa adanya, termasuk salah ketik. |
| Audit: siapa, apa, kapan, nilai sebelum dan sesudah | Karyawan | `audit_events` | Jejak perubahan | Tidak bisa diubah atau dihapus (trigger). Untuk pembuatan akun dan ganti email, email ikut tercatat. Login gagal mencatat email yang diketik. |
| Nama PIC, Sales PIC, penulis update dan catatan, penerima notifikasi | Karyawan | `pics`, `projects`, `project_actions`, `notifications`, `requests` | Penugasan dan riwayat kerja | |
| Kontak pihak luar: sumber eksternal, kontak eksternal, stakeholder | Customer, mitra, orang lain | `projects.external_source_name`, `external_contact`, `stakeholders` | Mengetahui siapa yang terlibat | **Teks bebas** hingga 4.000 karakter. Aplikasi tidak membatasi isinya, jadi nama, telepon, atau email orang luar bisa masuk. |
| Teks bebas lain: deskripsi project dan request, catatan | Siapa saja yang disebut | `projects`, `requests`, `project_actions` | Konteks pekerjaan | Sama: tidak ada pembatasan isi. |
| Nama perusahaan customer, industri, lokasi | Badan usaha | `customers`, `projects` | Pipeline | Data bisnis, bukan data pribadi, kecuali nama usaha perorangan. |

## 2. Di peramban pengguna

| Item | Isi | Umur | Catatan |
|---|---|---|---|
| Cookie sesi | Token acak | Sesuai sesi (maks. 7 hari) | HttpOnly, SameSite=Lax, Secure di produksi |
| Cookie `recent_accounts` | Nama, email, peran, sampai 5 akun terakhir di peramban itu | 30 hari | HttpOnly. Di komputer bersama, pengguna berikutnya melihat daftar rekan yang pernah masuk. Bisa dihapus per akun dari halaman login. |
| Cookie perangkat | Id dan token acak | Sesuai kredensial | HttpOnly |
| `localStorage` | Pilihan tema | Tetap | Bukan data pribadi |

## 3. Yang tidak dikumpulkan

- Tidak ada pustaka analitik, iklan, atau pelacak (tidak ada Google Analytics, Sentry, PostHog, dan sejenisnya).
- Peramban hanya memanggil API aplikasi sendiri. Font (Geist) dibundel saat build, tidak diunduh dari Google saat halaman dibuka.
- Tidak ada geolokasi, kamera, atau mikrofon. Header `Permissions-Policy` melarangnya.
- Tidak ada pendaftaran publik, formulir kontak, atau newsletter.
- Aplikasi tidak mengirim email (teks email disalin pengguna ke Outlook).
- IP dan user agent tidak disimpan di database. IP dipakai sesaat untuk pembatas login dan hanya disimpan sebagai hash.
- Telemetri Next.js dan Prisma dimatikan di image.
- Mesin pencari dilarang mengindeks (`noindex` di header dan meta).

## 4. Pihak yang memproses data (di luar kode)

| Pihak | Data | Catatan |
|---|---|---|
| Hostinger (VPS) | Seluruh database, backup, log container | Server produksi. |
| Neon | Salinan database (cadangan malam, dan sumber data sebelum pindah) | Wilayah dan perjanjian pemrosesan data perlu dicek. |
| Vercel (selama masih hidup) | Aplikasi lama dan log permintaan platform (IP, alamat) | Dihentikan setelah pindah. |
| GitHub | Hanya kode. Tidak ada data produksi di repo (`prisma/data`, `backups`, `DEV_ACCOUNTS.md` diabaikan git). | |

## 5. Log Caddy di VPS

Caddy mencatat setiap permintaan ke stdout Docker (5 x 10 MB). Sejak perbaikan ini: IP dipotong ke jaringannya (/24 IPv4, /48 IPv6), user agent dibuang, dan parameter `q` (kata pencarian) dan `account` (email di tautan login) dihapus dari alamat. Cookie dan Authorization tidak pernah dicatat secara bawaan. Alamat halaman (kode project, kode request) tetap tercatat.

## 6. Masa simpan saat ini

| Data | Masa simpan |
|---|---|
| Audit log | Selamanya (tidak bisa dihapus) |
| Akun karyawan | Tetap ada; nonaktif saat keluar (riwayat butuh nama) |
| Sesi, perangkat diingat | Sampai kedaluwarsa; baris lama tidak dihapus otomatis |
| Notifikasi | Tidak dibersihkan otomatis |
| Login gagal | Sampai login berhasil |
| Backup | Harian 30 hari (3 terbaru selalu ada); salinan Neon ditimpa tiap malam; dump pra-deploy 10 terbaru |

## 7. Celah yang diketahui dan saran

1. Teks bebas bisa memuat data pribadi orang luar. Tambahkan petunjuk di formulir dan tinjau isi yang sudah ada.
2. Hash IP (SHA-256 tanpa rahasia) bisa dibalik dengan mencoba semua alamat IPv4. Pakai HMAC dengan rahasia server.
3. Email yang diketik pada login gagal masuk ke audit log apa adanya. Potong atau hash bila akunnya tidak dikenal.
4. `recent_accounts` aktif untuk semua login. Jadikan pilihan ("ingat di perangkat ini") atau perpendek umurnya.
5. Tidak ada alat untuk memenuhi permintaan subjek data (ekspor atau hapus satu orang). Saat ini hanya menonaktifkan akun, dan audit log tidak bisa dihapus.
6. Backup dan dump belum dienkripsi.
7. Tidak ada halaman kebijakan privasi di aplikasi (lihat bagian 8).

## 8. Bahan jawaban untuk formulir yang menanyakan data pribadi

**List all personal information collected by your website**

> Halcom Dashboard is an internal business tool for employees of Halcom Inovasi. It has no public sign-up. It stores, for each employee account: full name, work e-mail address, role, and a salted hash of the password (the password itself is never stored). It also stores sign-in sessions (a hashed token and expiry time, no IP address or browser details), failed sign-in attempts (the e-mail typed and a hash of the IP address, used only to limit password guessing and deleted after a successful sign-in), and an audit log of actions (who did what and when). Work records may also include names and business contact details of customers and partners that employees type into free-text fields. The site sets only functional cookies (session, remembered accounts on that browser, theme). It uses no analytics, advertising, or tracking, and does not collect location, camera, or microphone data.

**Why does your website collect personal information?**

> To let employees sign in securely, to give each role the right access, to show who made each change (audit trail), to protect accounts against password guessing, and to record the business contacts needed to follow up customer projects and quotations. Data is used only inside the company for these purposes and is not sold or shared for advertising.

**Provide a link (URL) to your website's privacy statement**

Tautan harus ke halaman nyata yang bisa dibuka publik. Saat ini aplikasi belum punya halaman itu (semua halaman butuh login). Pilihan: (a) buat halaman `/privacy` publik di aplikasi, atau (b) tempel kebijakan privasi perusahaan di situs perusahaan. Jangan mengarang URL.
