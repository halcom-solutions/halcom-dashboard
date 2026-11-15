# Deploy lewat Docker Manager Hostinger (jalur sementara)

Tujuan: aplikasi bisa dibuka lewat domain dengan HTTPS. Image dibangun sekali di VPS lewat SSH (Docker Manager tidak bisa build dari URL Git privat), lalu compose hanya memakai image itu. Tanpa GHCR dan tanpa GitHub Actions.
Jalur penuh (backup sebelum migrasi, health check, rollback) tetap di [HOSTINGER.md](HOSTINGER.md).

## Sebelum mulai

1. A record domain sudah menunjuk ke IP VPS. Port 80 dan 443 terbuka (`ufw allow 80,443/tcp`) dan tidak dipakai Caddy atau nginx lain di host.
2. Token GitHub baca-saja: GitHub → Settings → Developer settings → Fine-grained tokens. Hanya repositori `halcom-solutions/halcom-dashboard`, izin **Contents: Read-only**, masa berlaku pendek.
   (Untuk repositori organization, owner org mungkin harus menyetujui token.)
3. Branch yang berisi berkas ini harus sudah di GitHub (`development`).

## Bangun image lewat SSH (sebelum Docker Manager)

Masuk SSH ke VPS sebagai `deploy` (user ini harus anggota grup `docker`; jika `docker ps` ditolak, tambahkan sebagai root: `usermod -aG docker deploy`, lalu login ulang). Token dibaca tanpa tampil dan tidak tersimpan:

```bash
read -rs -p "GitHub token: " GIT_TOKEN; echo
git clone --depth 1 -b development "https://x-access-token:${GIT_TOKEN}@github.com/halcom-solutions/halcom-dashboard.git" ~/halcom-src
cd ~/halcom-src && unset GIT_TOKEN
docker build --target migrator -t halcom-dashboard-migrate:hostinger .
docker build --target runner -t halcom-dashboard-app:hostinger .
cd ~ && rm -rf ~/halcom-src
docker images | grep halcom-dashboard
```

Untuk memperbarui versi, ulangi blok ini lalu deploy ulang di Docker Manager.

## Di hPanel → VPS → Docker Manager → Compose

Isi YAML dengan `deploy/compose.hostinger.yaml` (tempel isinya, atau URL raw-nya), lalu isi variabel:

| Variabel | Isi |
|---|---|
| `DOMAIN` | mis. `halcom.example.com` (tanpa `https://`) |
| `POSTGRES_USER` | `halcom` |
| `POSTGRES_PASSWORD` | acak, hanya `A-Za-z0-9-_.~` (`openssl rand -hex 24`) |
| `POSTGRES_DB` | `halcom` |
| `EMAIL_TO_*`, `EMAIL_CC_*` | opsional |

Deploy. Urutan: `db` sehat → `migrate` jalan sekali → `app` → `caddy`.
Caddy menerbitkan sertifikat saat pertama diakses; kalau DNS belum benar, lihat lognya (`caddy`).

## Akun pertama

Database baru kosong dan image produksi tidak memuat `db:bootstrap-superadmin`. Pulihkan dump dari Neon (lihat HOSTINGER.md) atau minta target image `tools`.

## Batas jalur ini

- Tidak ada backup otomatis sebelum migrasi dan tidak ada rollback. Ambil dump manual sebelum memperbarui:
  `docker exec <container db> pg_dump -U halcom -Fc halcom > pra-update.dump`.
- Memperbarui: bangun ulang image lewat SSH, lalu deploy ulang proyek. Migrasi baru ikut jalan lewat `migrate`.
- Token GitHub hanya dipakai saat `git clone` di SSH; cabut setelah image jadi.
- Jangan jalankan jalur ini bersamaan dengan `compose.prod.yaml` di VPS yang sama (nama proyek dan port sama).

## Deploy otomatis dari GitHub (CD)

Workflow **Actions → Deploy to Hostinger → Run workflow** (isi `ref`, mis. `development`) mengirim commit ke VPS lewat SSH, membangun image, membuat dump di `/opt/halcom/predeploy`, menjalankan migrasi, memulai ulang `app` di stack `halcom-dashboard` yang sama, dan mengembalikan image lama bila `/api/health` tidak sehat.

Sekali di VPS (sebagai root):

```bash
mkdir -p /opt/halcom && chown deploy:deploy /opt/halcom && usermod -aG docker deploy
```

Buat `/opt/halcom/.env` (`chmod 600`, pemilik `deploy`) berisi nilai yang sama dengan environment di Docker Manager:

```
DOMAIN=...
POSTGRES_USER=halcom
POSTGRES_PASSWORD=...
POSTGRES_DB=halcom
```

Sekali di GitHub: Settings → Environments → `production` (Required reviewers), dengan secret `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_PORT` (opsional), `VPS_SSH_KEY` (kunci privat khusus CI), `VPS_KNOWN_HOSTS` (hasil `ssh-keyscan -t ed25519 IP`, cocokkan sidik jarinya).

Skrip berhenti bila volume `halcom-dashboard_postgres_data` tidak ada, supaya tidak membuat database kosong. Cek namanya dulu: `docker volume ls | grep postgres`.

## Dua alamat sekaligus: domain dan nama host VPS

`deploy/Caddyfile` melayani dua alamat bersamaan, masing-masing dengan sertifikatnya sendiri, supaya satu alamat tetap bisa dibuka saat yang lain bermasalah (domain pernah ditangguhkan):

| Variabel di `/opt/halcom/.env` | Isi | Fungsi |
|---|---|---|
| `DOMAIN` | `halcom-dashboard.site` | Alamat utama; juga alamat di tautan teks email (`APP_BASE_URL`). |
| `FALLBACK_DOMAIN` | bawaan `srv2127418.hstgr.cloud` (tidak perlu diisi) | Nama host VPS, selalu dilayani. |

Keduanya harus berbeda: deploy berhenti dengan pesan jelas kalau sama. Cookie login terikat ke satu nama host, jadi pengguna login ulang saat berpindah alamat.
Saat domain utama bermasalah dan tautan di teks email harus memakai alamat lain, **tukar** isinya (`DOMAIN=srv2127418.hstgr.cloud`, `FALLBACK_DOMAIN=halcom-dashboard.site`), lalu:

```bash
cd /opt/halcom && docker compose -p halcom-dashboard -f compose.hostinger.yaml up -d --no-deps --force-recreate app caddy
```

Selama domain utama ditangguhkan, Caddy mencatat error sertifikat untuk alamat itu di log; alamat satunya tetap berjalan, dan sertifikat yang sudah terbit tetap dipakai sampai kedaluwarsa.

## Backup harian di VPS (`backup-daily.sh`)

Skrip `deploy/backup-daily.sh` ikut disalin ke `/opt/halcom` oleh workflow deploy. Tiap hari ia membuat satu dump penuh ke volume `/backups` milik
aplikasi, jadi berkasnya tampil di halaman **Backups** dan bisa diunduh dari sana (hanya Superadmin, tiap unduhan masuk audit log).

- Nama berkas `halcom-auto-YYYYMMDD-HHMMSSZ.dump`, izin 600. Dump diperiksa dengan `pg_restore --list` sebelum diberi nama akhir.
- Retensi: berkas `halcom-auto-` yang lebih tua dari 30 hari dihapus oleh skrip (bukan oleh aplikasi), tetapi 3 yang terbaru selalu disimpan. Berkas buatan tangan dari halaman Backups tidak pernah dihapus. Ubah dengan `KEEP_DAYS` dan `MIN_KEEP` di baris cron.
- Dump ada di VPS yang sama dengan database: ini bukan pengganti salinan di luar server. Unduh secara berkala ke PC Anda (dan simpan di folder terenkripsi), dan salinan Neon malam tetap berjalan.

Pasang cron sekali, sebagai user `deploy` (`crontab -e`; jam mengikuti zona waktu server, UTC secara bawaan, jadi 20:30 UTC adalah 03:30 WIB):

```
30 20 * * * /opt/halcom/backup-daily.sh >> /opt/halcom/backup.log 2>&1
```

Uji sekali dengan tangan setelah deploy berikutnya: `/opt/halcom/backup-daily.sh`, lalu buka halaman Backups. Lihat riwayatnya di `/opt/halcom/backup.log`.
Cek tiap beberapa hari bahwa berkas `halcom-auto-` terbaru berumur kurang dari 26 jam.

## Peringatan SLA (`sla-scan.sh`)

Batas SLA yang mendekat atau terlewat bukan kejadian yang dilakukan seseorang, jadi sebuah cron memintanya diperiksa (D-083). Skrip `deploy/sla-scan.sh` ikut disalin ke `/opt/halcom` oleh workflow deploy. Ia memanggil `POST /api/internal/sla-scan` di dalam container `app` (port 3000 sendiri, tidak lewat Caddy) dengan secret `CRON_SECRET`. Aplikasi lalu menulis notifikasi **Warning** (mendekati batas) untuk tim yang menangani, dan **Danger** (melewati batas) untuk tim itu ditambah Admin dan Management. Memanggil ulang tidak menggandakan notifikasi.

1. Buat secret sekali: `openssl rand -hex 24`, taruh di `/opt/halcom/.env` sebagai `CRON_SECRET=...` (minimal 16 karakter; kosong berarti endpoint mati dan tidak ada peringatan). Lalu deploy ulang atau `docker compose ... up -d app` agar container membacanya.
2. Pasang cron sebagai user `deploy`. Tiap 30 menit pada hari kerja, 08:00 sampai 18:00 WIB (01:00 sampai 11:00 UTC):

```
*/30 1-11 * * 1-5 /opt/halcom/sla-scan.sh >> /opt/halcom/sla-scan.log 2>&1
```

3. Uji dengan tangan: `/opt/halcom/sla-scan.sh` harus mencetak `200` dan jumlah `checked`, `warnings`, `dangers`, `closed`. Jawaban `404` berarti `CRON_SECRET` kosong di container, `401` berarti secret salah.

Peringatan terlambat paling lama selisih satu interval (30 menit) dari saat batas terlewat. Peringatan request yang sudah selesai atau dibatalkan otomatis ditandai terbaca.

## Data dari Neon ke VPS, perpindahan, dan cadangan malam (`db-sync.sh`)

Skrip `deploy/db-sync.sh` ikut disalin ke `/opt/halcom` oleh workflow deploy. Rahasianya di `/opt/halcom/neon.env` (`chmod 600`, pemilik `deploy`, tidak masuk repo):

```
NEON_URL=postgresql://...direct-bukan-pooler...?sslmode=require
NEON_BACKUP_URL=postgresql://...database-Neon-yang-lain...?sslmode=require
```

`NEON_BACKUP_URL` boleh sama dengan `NEON_URL` (database Neon yang dulu dipakai aplikasi lama), karena setelah cutover tidak ada lagi yang menulis ke sana. `vps-to-neon` **menimpa** database itu setiap kali berjalan dan baru boleh berjalan setelah `CUTOVER_DONE` ada.

| Tahap | Perintah | Efek |
|---|---|---|
| Sebelum pindah | `db-sync.sh neon-to-vps` (cron malam) | Menimpa database VPS dengan salinan Neon, menjalankan migrasi yang belum ada di Neon, lalu menyalakan `app`. Sebelum menimpa, database VPS disimpan di `sync/vps-before-*.dump`. |
| Malam pindah | `db-sync.sh cutover` | Salinan terakhir, lalu membuat `/opt/halcom/CUTOVER_DONE`. Hentikan dulu pemakaian aplikasi lama. |
| Sesudah pindah | `db-sync.sh vps-to-neon` (cron malam) | Cadangan malam VPS ke database cadangan di Neon. Dump 7 terbaru tersimpan di `sync/`. |

Pengaman: `neon-to-vps` dan `cutover` menolak berjalan setelah `CUTOVER_DONE` ada, dan `vps-to-neon` menolak berjalan sebelum `CUTOVER_DONE` ada. Jadi arahnya tidak bisa tertukar. Selama tahap pertama, **jangan pakai aplikasi di VPS untuk memasukkan data**: setiap malam datanya ditimpa dari Neon.

Cron untuk user `deploy` (`crontab -e`). Tahap pertama:

```
0 2 * * * /opt/halcom/db-sync.sh neon-to-vps >> /opt/halcom/sync/cron.log 2>&1
```

Setelah `cutover`, ganti barisnya dengan:

```
30 2 * * * /opt/halcom/db-sync.sh vps-to-neon >> /opt/halcom/sync/cron.log 2>&1
```

Uji sekali dengan tangan sebelum dijadwalkan: `/opt/halcom/db-sync.sh neon-to-vps`.
