# Bypass Link — ditxzproduct

## Deploy dari HP Android ke Render
1. Ekstrak ZIP.
2. Buat repository baru di GitHub.
3. Upload seluruh isi folder project ke repository (pastikan `server.js`, `package.json`, `render.yaml`, folder `public/`, dan `README.md` ada di root).
4. Buka https://render.com dan daftar / masuk.
5. Pilih **New → Blueprint** (jika tersedia), lalu hubungkan repository GitHub. Render membaca `render.yaml`.
   Alternatif: pilih **New → Web Service**, pilih repository, Runtime `Node`, Build Command `npm install`, Start Command `npm start`, lalu pilih Free.
6. Tunggu deploy selesai. Buka alamat `https://<nama-service>.onrender.com`.

## Batasan hosting gratis
Render Free dapat menidurkan service setelah 15 menit tanpa trafik; request pertama setelah tidur dapat menunggu sekitar satu menit. Ini cocok untuk demo, bukan layanan produksi.

## Resolver dan batasannya
Default resolver hanya menghubungi hostname `sfl.gl` dan `www.sfl.gl`, dan hanya mengikuti redirect HTTP 3xx biasa. Jika provider memakai JavaScript, CAPTCHA, timer, login, interstitial iklan, atau verifikasi lain, resolver tidak melewatinya. Domain tujuan publik dikembalikan tanpa diakses oleh server.
