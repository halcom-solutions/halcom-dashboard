# Security checklist after deploy (Hostinger VPS)

Dipakai **setelah** aplikasi hidup di Hostinger (Ubuntu 26.04; `compose.hostinger.yaml`: container `db`, `migrate`, `app`, dan `caddy`; image dibangun di VPS oleh workflow `Deploy to Hostinger`; Neon sebagai salinan lewat `db-sync.sh`), dan diulang sesuai jadwal di bagian 11.
Isi tiap kotak dengan tanggal dan inisial orang yang memeriksa. Bukti (perintah atau tangkapan layar) disimpan di tiket atau catatan deploy, bukan di repo.

Prioritas: **P0** wajib sebelum pengguna sungguhan masuk, **P1** dalam minggu pertama, **P2** dalam bulan pertama.
Kolom "Cek" memberi perintah atau cara membuktikannya. Item bertanda **[kode]** butuh perubahan di repo; statusnya ada di bagian 12.

## 1. Gerbang sebelum go-live

- [ ] **P0** Domain mengarah ke VPS dan HTTPS valid (bukan sertifikat uji). Cek: `curl -I https://<domain>` memberi 200 atau 307 tanpa peringatan sertifikat.
- [ ] **P0** Akun superadmin pertama dibuat dengan `npm run db:bootstrap-superadmin` (hanya jalan sekali, selama belum ada superadmin) dan kata sandi awal sudah diganti (`must_change_password`).
- [ ] **P0** Tidak ada akun contoh. Cek: tidak ada pengguna `*@example.invalid` dan seed (`db:seed`) tidak pernah dijalankan di produksi (`APP_ENV=production` menolaknya).
- [ ] **P0** Satu backup penuh sudah dibuat dan **berhasil dipulihkan** ke database lain (bagian 8).
- [ ] **P0** Dua orang tahu cara masuk ke VPS, GitHub org, dan Neon (bagian 10).

## 2. Server (Ubuntu 26.04)

| Status | P | Item | Cek |
|---|---|---|---|
| [ ] | P0 | Login SSH hanya dengan kunci, root dan kata sandi dimatikan | `sudo sshd -T \| grep -E "passwordauthentication\|permitrootlogin"` memberi `no` dan `no` (atau `prohibit-password`) |
| [ ] | P0 | Firewall hanya membuka 22, 80, 443 | `sudo ufw status verbose`; dari luar: `nmap -Pn <ip>` hanya menampilkan tiga port itu |
| [ ] | P0 | User deploy bukan root dan tidak punya sudo bebas | `id deploy`; `sudo -l -U deploy` |
| [ ] | P1 | fail2ban untuk SSH aktif | `sudo fail2ban-client status sshd` |
| [ ] | P1 | `unattended-upgrades` aktif untuk pembaruan keamanan, tanpa reboot otomatis di jam kerja | `systemctl status unattended-upgrades`; `apt list --upgradable` |
| [ ] | P1 | Swap 2 GB aktif | `swapon --show` |
| [ ] | P1 | Waktu server sinkron (log dan audit memakai UTC) | `timedatectl` menunjukkan `System clock synchronized: yes` |
| [ ] | P2 | Akun pengguna server yang tidak dipakai dihapus, kunci SSH orang yang sudah keluar dicabut | `cat ~/.ssh/authorized_keys` tiap user |

## 3. Jaringan, TLS, Caddy

| Status | P | Item | Cek |
|---|---|---|---|
| [ ] | P0 | Container `app` tidak punya port yang dipublikasikan ke host: hanya Caddy (container) yang menjangkaunya lewat jaringan Docker. Penting: aplikasi memakai nilai pertama `x-forwarded-for` untuk pembatas login, jadi `app` tidak boleh bisa dijangkau langsung | `docker compose -p halcom-dashboard -f /opt/halcom/compose.hostinger.yaml ps` tanpa pemetaan port untuk `app` dan `db`; `nmap -Pn <ip>` hanya 22, 80, 443 |
| [ ] | P0 | Database tidak punya port publik | tidak ada `ports:` untuk `db` di `compose.hostinger.yaml`; `nmap -p 5432 <ip>` tertutup |
| [ ] | P0 | HTTP dialihkan ke HTTPS | `curl -I http://<domain>` memberi 301 atau 308 ke `https://` |
| [ ] | P0 | Caddy mengirim IP klien yang benar, tidak mempercayai `X-Forwarded-For` dari luar | dari luar, kirim satu login yang salah dengan header palsu (`curl -H "X-Forwarded-For: 1.2.3.4" ...`), lalu lihat baris `scope = ip` di tabel `login_attempts`: kuncinya harus berasal dari IP asli Anda (atau hash-nya), bukan `1.2.3.4` |
| [ ] | P1 | TLS 1.2+ saja, tanpa protokol lama | uji di SSL Labs atau `testssl.sh <domain>` |
| [ ] | P1 | Header keamanan dikirim Caddy (sudah ada di `deploy/Caddyfile`): `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `X-Robots-Tag` | `curl -sI https://<domain> \| grep -iE "strict\|x-content\|referrer\|x-frame\|permissions\|robots"` |
| [ ] | P1 | Form dan Server Actions bekerja di balik proxy | masuk dan simpan satu form; tidak ada error "Invalid Server Actions request" |
| [ ] | P2 | CSP (mulai mode report-only) **[kode]** | header `Content-Security-Policy-Report-Only` ada, lalu diperketat |
| [ ] | P2 | HSTS preload hanya setelah semua subdomain HTTPS | jangan aktifkan lebih awal |
| [ ] | P0 | Endpoint cron tidak terjangkau dari internet (`/api/internal/*` dijawab 404 oleh Caddy; skrip cron memanggilnya lewat port `app` sendiri) | `curl -s -o /dev/null -w "%{http_code}" -X POST https://<domain>/api/internal/sla-scan` memberi `404` |
| [ ] | P1 | Log Caddy tidak memuat data pribadi: IP dipotong (/24, /48), tanpa user agent, tanpa parameter `q` dan `account` | `docker compose -p halcom-dashboard -f /opt/halcom/compose.hostinger.yaml logs --tail 20 caddy` |
| [ ] | P1 | `deploy-vps.sh` memvalidasi Caddyfile sebelum mengganti apa pun (deploy berhenti bila tidak valid) | jalankan deploy setelah mengubah Caddyfile dan baca baris `caddy validate` |

## 4. Container

| Status | P | Item | Cek |
|---|---|---|---|
| [ ] | P0 | Image dibangun dari commit yang dideploy dan diberi tag SHA 12 karakter (workflow `Deploy to Hostinger` mengirim kode lewat `git archive`, VPS tidak memegang token GitHub) | `cat /opt/halcom/.last_good_tag`; `docker images \| grep halcom-dashboard` |
| [ ] | P0 | `app` berjalan sebagai user `node` (bukan root), `cap_drop: ALL`, `no-new-privileges` | `docker inspect <app> --format '{{.Config.User}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}'` |
| [ ] | P0 | Migrasi tidak jalan otomatis saat aplikasi start | hanya lewat `deploy-vps.sh` (dump `predeploy` dulu, lalu `migrate`); `ls /opt/halcom/predeploy` |
| [ ] | P1 | Healthcheck sehat | `docker compose -p halcom-dashboard -f /opt/halcom/compose.hostinger.yaml ps` menunjukkan `healthy`; `curl https://<domain>/api/health` memberi status ok |
| [ ] | P1 | Log berotasi (5 x 10 MB) dan disk tidak penuh | `docker inspect --format '{{.HostConfig.LogConfig}}'`; `df -h` |
| [ ] | P1 | Tidak ada rahasia di image atau log | `docker history <image>`; `docker compose logs app \| grep -iE "password\|secret\|token"` kosong |
| [ ] | P2 | Image dasar disematkan dengan digest. `caddy:2` di `compose.hostinger.yaml` masih tag mengambang: sematkan digest-nya dan perbarui berkala (Dependabot) | `docker inspect caddy --format "{{.Image}}"`; PR Dependabot ditinjau tiap minggu |
| [ ] | P1 | Rahasia yang sama (`POSTGRES_PASSWORD`, `DOMAIN`) ada di Docker Manager hPanel **dan** di `/opt/halcom/.env`: keduanya sama, `.env` berizin 600, dan akses ke panel Hostinger dibatasi dua orang | bandingkan nilai di kedua tempat |
| [ ] | P1 | `CRON_SECRET` acak minimal 16 karakter di `/opt/halcom/.env` (kosong membuat endpoint mati) | `grep -c "^CRON_SECRET=.\{16,\}" /opt/halcom/.env` memberi 1 |
| [ ] | P1 | `neon.env` berizin 600 dan berisi alamat **langsung** (bukan pooler); `CUTOVER_DONE` ada setelah pindah sehingga `neon-to-vps` tidak bisa menimpa database VPS | `stat -c "%a" /opt/halcom/neon.env`; `ls /opt/halcom/CUTOVER_DONE` |

## 5. Rahasia dan konfigurasi

| Status | P | Item | Cek |
|---|---|---|---|
| [ ] | P0 | `.env` di VPS berizin 600, dimiliki user deploy, tidak ada di git | `stat -c "%a %U" .env`; `git ls-files \| grep -E "^\.env"` kosong |
| [ ] | P0 | Kata sandi database acak (`openssl rand -hex 24`), hanya karakter URL-aman | tidak sama dengan yang dipakai di dev atau Neon |
| [ ] | P0 | `SEED_USER_PASSWORD` tidak ada di `.env` produksi | `grep SEED .env` kosong |
| [ ] | P0 | `APP_BASE_URL` berisi alamat HTTPS publik | tautan di teks email memakai domain yang benar |
| [ ] | P1 | Daftar email `EMAIL_TO_*` dan `EMAIL_CC_*` hanya berisi alamat perusahaan yang benar | cek di halaman Email |
| [ ] | P1 | Kredensial Neon hanya di `/etc/halcom/backup.env` (600), tidak di `.env` aplikasi dan tidak di container `app` | `docker compose exec app env \| grep -i neon` kosong |
| [ ] | P1 | Semua rahasia punya pemilik dan jadwal rotasi (kata sandi DB, kunci deploy, token Neon) | tabel di runbook |

## 6. Akses aplikasi

Fakta dari kode: kata sandi di-hash dengan scrypt (N=2^16), sesi di server dan cookie hanya menyimpan token acak (hash-nya disimpan), cookie `HttpOnly`, `SameSite=Lax`, `Secure` di production, sesi 12 jam tidak aktif dan maksimal 7 hari, pembatas login 5 percobaan per email dan 25 per alamat dalam 15 menit.

- [ ] **P0** Cookie sesi berflag `Secure` dan `HttpOnly`. Cek: DevTools → Application → Cookies setelah masuk lewat HTTPS.
- [ ] **P0** Pembatas login bekerja. Cek: 6 percobaan salah untuk satu email membuat akun terkunci sementara, dan tercatat di audit log.
- [ ] **P0** Hanya Superadmin yang memegang `permissions.manage`, `users.manage-privileged`, dan `system.backup`. Cek di halaman Permissions.
- [ ] **P1** Peran tiap akun sesuai tugas (Sales, SOA, Purchasing, Finance, Management); Admin dan Superadmin sesedikit mungkin (disarankan 2 Superadmin, bukan 1).
- [ ] **P1** Akun orang yang sudah keluar dinonaktifkan (menonaktifkan langsung mencabut akses). Tinjau daftar Users tiap bulan.
- [ ] **P1** Audit log terbaca dan mencatat masuk, keluar, ganti kata sandi, backup, dan perubahan hak akses. Cek: lakukan satu tindakan lalu temukan barisnya.
- [ ] **P1** Tabel audit tidak bisa diubah. Cek (di DB uji): `UPDATE`, `DELETE`, `TRUNCATE` pada `audit_events` ditolak oleh trigger.
- [ ] **P2** Kebijakan kata sandi dikomunikasikan (minimal 8 karakter, tidak dipakai ulang). Pertimbangkan MFA atau SSO nanti; belum ada di aplikasi.

## 7. Database

- [ ] **P0** PostgreSQL 18 (dibutuhkan `uuidv7()`). Cek: `SELECT version();`.
- [ ] **P0** Aplikasi memakai pengguna DB khusus aplikasi, bukan superuser, dan database hanya bisa dijangkau dari jaringan Docker.
- [ ] **P1** `shared_buffers` dan memori wajar untuk 4 GB (satu DB + satu app). Cek: `docker stats --no-stream`.
- [ ] **P1** Ruang disk cukup untuk database ditambah backup. Alarm di 80 persen.
- [ ] **P2** `pg_stat_statements` atau pemantauan query lambat dinyalakan bila laporan melambat.

## 8. Backup dan pemulihan

- [ ] **P0** Backup harian berjalan (cron `deploy/backup-daily.sh`) dan menghasilkan `halcom-auto-YYYYMMDD-HHMMSSZ.dump` berizin 600. Cek: `docker compose -p halcom-dashboard -f /opt/halcom/compose.hostinger.yaml exec app ls -l /backups`, `crontab -l`, `tail /opt/halcom/backup.log`.
- [ ] **P0** **Uji restore**: pulihkan dump terbaru ke database kosong, lalu bandingkan jumlah baris tabel utama (projects, requests, users, audit_events). Catat hasilnya.
- [ ] **P0** Salinan Neon terisi tiap malam, ke database **terpisah** dari produksi mana pun. Cek: jumlah baris di Neon sama dengan VPS.
- [ ] **P1** Peringatan jika backup lebih tua dari 26 jam atau restore ke Neon gagal, dikirim ke milis grup, bukan satu orang.
- [ ] **P1** Retensi berjalan: dump otomatis disimpan 30 hari (3 terbaru selalu tersisa), yang lebih lama dihapus oleh `backup-daily.sh`, bukan oleh aplikasi (D-068). Disk tidak terisi dump lama.
- [ ] **P1** Tombol **Unduh** di halaman Backups hanya untuk pemegang `system.backup`, hanya menerima nama berkas yang valid, dan tiap unduhan masuk audit log **[kode: sudah ada, D-080]**. Cek: unduh satu berkas lalu cari `system.backup_downloaded` di Audit log.
- [ ] **P1** Salinan di PC Superadmin (untuk OneDrive/SharePoint) tersimpan di folder terenkripsi, dan pengingat mingguan ada. Dump berisi data customer: jangan dikirim lewat email atau chat.
- [ ] **P2** Dump dienkripsi (mis. `age`) sebelum keluar dari VPS, kuncinya disimpan terpisah.
- [ ] **P2** RPO dan RTO tertulis (contoh: RPO 24 jam, RTO 2 jam) dan diuji sekali dalam latihan.

## 9. GitHub organization dan CI/CD

- [ ] **P0** Minimal 2 owner organization dengan email perusahaan, 2FA wajib untuk semua anggota.
- [ ] **P0** Ruleset `main`: wajib PR, CI hijau, tanpa force-push, tanpa hapus branch.
- [ ] **P0** Tidak ada token pribadi (PAT) di workflow. Image dikirim dengan `GITHUB_TOKEN`; VPS menarik image memakai token sementara dari job deploy.
- [ ] **P1** Secret deploy di environment `production` (bukan secret repo), dengan penyetuju dari tim `ops`.
- [ ] **P1** Kunci SSH deploy khusus CI, dibatasi ke skrip deploy (`command=` di `authorized_keys`).
- [ ] **P1** Izin workflow minimal (`contents: read` bawaan), action di-pin ke SHA, runner `ubuntu-24.04`.
- [ ] **P1** Dependabot aktif (npm, Docker, Actions). Secret scanning dan push protection aktif di repo.
- [ ] **P2** Anggota yang keluar dicabut dari org dan dari tim; tinjau akses tiap kuartal.

## 10. Akun di luar kode (Hostinger, Neon, domain)

- [ ] **P0** Akun Hostinger, Neon, dan registrar domain terdaftar dengan **email grup perusahaan**, 2FA aktif, minimal dua orang bisa masuk.
- [ ] **P0** Kata sandi dan kode pemulihan di pengelola kata sandi perusahaan, dengan prosedur darurat ("siapa membuka bila pemilik tidak ada") di runbook.
- [ ] **P1** Token API Neon hanya berizin secukupnya, berpemilik jelas, dan masuk jadwal rotasi.
- [ ] **P1** Proyek Vercel lama sudah dihapus atau diputus dari repo ini (tidak ada lagi yang menerbitkan aplikasi dari `main` di sana), dan token serta variabel lingkungannya dicabut.
- [ ] **P2** Snapshot atau backup VPS dari panel Hostinger diaktifkan bila tersedia (cek apakah termasuk paket); anggap itu tambahan, bukan pengganti backup database.

## 11. Pemantauan dan jadwal berkala

| Kapan | Yang diperiksa |
|---|---|
| Harian (otomatis) | Backup sukses, restore Neon sukses, uptime `https://<domain>/api/health`, disk di bawah 80 persen |
| Mingguan | Daftar login gagal dan penguncian di audit log; PR Dependabot; pembaruan OS yang menunggu reboot; pengingat salinan manual ke SharePoint |
| Bulanan | Uji restore penuh; tinjau daftar Users dan peran; sertifikat TLS masih valid (Caddy memperbarui otomatis, cek tanggal); ruang disk dan ukuran database |
| Per kuartal | Rotasi rahasia; tinjau akses GitHub org dan tim; `npm audit --omit=dev`; latihan pemulihan dari nol (VPS baru, pulihkan dump) |

- [ ] **P1** Pemantau uptime eksternal (gratis) menghubungi `/api/health` dan mengirim peringatan ke milis grup.
- [ ] **P2** Log terstruktur dan penyimpanan log di luar VPS **[kode]** bila kebutuhan audit bertambah.

## 12. Celah di kode yang diketahui (diperiksa dari repo pada 2026-11-04)

| Celah | Status |
|---|---|
| Header keamanan (HSTS, nosniff, referrer, frame, permissions) | Dipasang oleh Caddy (`deploy/Caddyfile`, D-079), bukan oleh aplikasi; aplikasi sendiri hanya mengirim `Cache-Control: no-store`. Verifikasi dengan `curl -sI` setelah deploy |
| CSP belum ada | Belum |
| `serverActions.allowedOrigins` perlu memuat domain produksi di balik proxy | Cek saat deploy |
| Pembatas login membaca nilai pertama `x-forwarded-for`; aman hanya jika port 3000 tertutup untuk umum dan Caddy menimpa header dari klien | Dijaga lewat bagian 3 |
| Tombol Unduh backup untuk Superadmin | Ada (D-080) |
| Sesi dan notifikasi lama tidak dibersihkan otomatis | Belum |
| Satu endpoint `/api/health` untuk liveness dan readiness: gangguan DB menandai container tidak sehat | Diterima untuk satu VPS |
| Log terstruktur dan pemantauan | Belum |
| MFA / SSO | Belum ada |

## 13. Bila terjadi insiden

1. **Hentikan**: matikan akses (blokir di Caddy atau `docker compose stop app`), jangan hapus log.
2. **Amankan bukti**: salin `docker compose logs`, log Caddy, dan tabel audit sebelum perubahan apa pun.
3. **Batasi**: nonaktifkan akun yang terdampak di Users (langsung mencabut akses), putar ulang rahasia yang mungkin bocor, cabut kunci SSH dan token.
4. **Pulihkan**: dari backup terakhir yang sudah teruji, di VPS yang bersih bila server diduga dikuasai.
5. **Laporkan** ke atasan dan pihak yang berwenang di perusahaan; catat kronologi dan perbaikannya di `docs/decisions/DECISIONS.md`.
