<div dir="rtl" align="center">

# 🛡️ P00RIJÃ Cryptography Suite v2.80
### سوئیت پیشرفته رمزنگاری P00RIJÃ (ورژن 2.80)

**New in Version 2.80:**
- **Passkey / Biometric Unlock**: WebAuthn-based quick unlock for supported devices and browsers.
- **Desktop Biometric Prompt**: On desktop builds, the app can prompt once to enable quick local unlock when a platform authenticator is available.
- **Secure Share Links & Bundles**: Create encrypted links/bundles for text, secure notes, small files, and public keys with expiry and view limits.
- **Digital Signatures**: Sign and verify text/files with `ECDSA` and `RSA-PSS`.
- **Security Center**: Built-in health dashboard for passkey, 2FA, backup freshness, weak password hygiene, and legacy-key review.
- **Smart Wizard**: Guided scenario launcher for common workflows like encrypt-for-self, share-securely, sign/verify, and self-destruct.
- **Secure Notes**: Encrypted private notes stored inside the app and shareable through secure bundles.
- **Secure Chat Relay**: Telegram-style encrypted chat workspace with persistent local history, PeerJS/WebRTC transport, encrypted offline relay queues, Web Push alerts, optional coturn TURN traversal, voice messages, timed messages, file transfer, calls, groups, and channels.
- **Dashboard UI + PWA + Desktop**: Responsive sidebar dashboard, installable PWA, and Tauri desktop packaging.
- **Desktop Icon Profiles**: Switch between the main app icon style, alternate shield themes, and low-attention desktop-style profiles inside the desktop build.

[![License: GPL v3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)]()
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)]()
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)]()

[🇬🇧 English](#english) | [🇮🇷 فارسی](#فارسی)

</div>

---

<a name="english"></a>
## 🇬🇧 English

### 🌟 Overview
**P00RIJÃ Cryptography Suite 2.80** is a fully client-side cryptography dashboard for secure file/text encryption, key management, password workflows, secure sharing, digital signatures, and local-only private data handling. It runs in the browser, as a PWA, inside Docker, and inside a native Tauri desktop shell while keeping cryptographic operations on the client side.

### ✨ Features
*   🔐 **Text & File Encryption/Decryption:** Securely encrypt and decrypt messages and files using modern Web Crypto workflows.
*   🧩 **Web Crypto Algorithm Catalog:** Modern flows are standardized around `AES-GCM`, `AES-CTR`, legacy-compatibility `AES-CBC`, and hybrid `RSA-OAEP-3072/4096 + AES-256-GCM` with per-algorithm key sizes and correct key types.
*   ⚙️ **Advanced Encryption Controls:** Password-based flows now expose `PBKDF2` iterations, hash selection, salt length, `AES-GCM` tag length, `AES-CTR` counter length, `AAD/context`, and `RSA-OAEP` label defaults in both the Encrypt tab and the global encryption settings.
*   🔄 **Automatic Legacy Migration:** Older saved settings and key records are normalized automatically so existing browser data can move forward to the new algorithm model without manual cleanup.
*   🔓 **Passkey / Biometric Unlock:** Unlock the app faster with WebAuthn passkeys on supported browsers/devices.
*   🪪 **Desktop Biometric Prompt:** In the desktop shell, the app can offer a one-time prompt to enable quick local unlock when a compatible platform authenticator is available.
*   🔑 **Advanced Password Generator:** Generate strong, random passwords with customizable criteria (length, letters, numbers, symbols) and specific placement rules, along with a strength meter.
*   🗄️ **Key Management:** Store and manage your encryption keys locally in your browser.
*   📝 **Secure Notes:** Save encrypted notes locally under the same master-password security model and share them as secure bundles.
*   💬 **Secure Chat:** Use the in-app encrypted messenger for direct chats, local groups/channels, file sharing, voice messages, timed messages, delivery/seen ticks, reactions, call history, and voice/video calls. Direct sessions use WebRTC where possible; encrypted relay queues and Web Push can notify offline users without exposing message contents.
*   🔗 **Secure Share:** Create encrypted links or bundle files for text, notes, files, and public keys with expiry and view-limit controls.
*   ✍️ **Digital Signatures:** Sign and verify text or files using `ECDSA-P256`, `ECDSA-P384`, and `RSA-PSS-3072`.
*   🩺 **Security Center:** Review backup freshness, passkey/2FA readiness, weak or duplicate password hygiene, and legacy key exposure from one dashboard.
*   🧭 **Smart Wizard:** Jump into guided scenarios that preset the right tab and recommended cryptographic mode for common tasks.
*   🚀 **Migration System:** Export and import all your settings, keys, passwords, and data securely across different systems using an encrypted backup file.
*   🖼️ **Steganography:** Hide secret text inside standard image files without visibly altering them.
*   ♻️ **File Shredder:** Securely destroy files by overwriting them with zero bytes.
*   🔡 **Custom Typography:** Personalize the interface by selecting your preferred Persian and English fonts and font sizes.
*   🛡️ **Two-Factor Authentication (2FA):** Enhance security with TOTP-based 2FA integration.
*   🧭 **Dashboard Navigation:** The app now uses a vertical dashboard sidebar on desktop, plus a hamburger drawer for tablet and mobile layouts.
*   🗂️ **History Filters & Sorting:** Encryption and decryption history now support search, algorithm filtering, and sorting by date, name, or size.
*   🧷 **Setup Terms & Recovery Layout:** The registration/first-run screen now separates the master-password panel and recovery questions into wider columns and includes Terms, GPL license, and disclaimer links.
*   🖼️ **Desktop Icon Profiles:** Desktop users can switch between branded and low-attention icon profiles at runtime for a calmer or more discreet visual shell.
*   🐳 **Docker Web Runtime:** The app can also run inside a Docker container on port `8585`, with separate `amd64` and `arm64` images for browser access over localhost or the local network.
*   ✨ **Richer Motion & Themes:** Added app-wide panel transitions, floating ambient highlights, and new themes such as Aurora, Sunset, Linen, and Obsidian alongside the previous theme set.
*   📲 **Installable PWA:** Ships with a web app manifest, offline-ready service worker, install prompt wiring, and app shortcuts.
*   ⏱️ **Custom Auto-Lock:** Automatically lock your workspace after a period of inactivity. Supports custom minute configurations.
*   🌐 **Bilingual Interface:** Fully supports both English and Persian languages, ensuring flawless right-to-left (RTL) toggle animations and complete translations.
*   🚀 **Client-Side Only:** No backend server required. All operations are performed locally using JavaScript.

### 🚀 How to Run
Since the application is completely client-side, there are no server dependencies to install.

1.  Clone the repository or download the source code.
2.  Open the `index.html` file directly in any modern web browser.
    *   *Alternatively, you can run a simple local web server (e.g., `python -m http.server`) and navigate to the local address.*

### 🧪 Testing
Automated checks now run directly through the Node.js toolchain that ships with the project dependencies:
```bash
npm install
npm test
npm run test:smoke
```

`npm test` runs the translation and configuration unit checks. `npm run test:smoke` launches a local static server plus a Playwright browser and verifies the main client-side flows end-to-end, including the Persian setup layout, security-question filtering, tab-order customization, responsive dashboard navigation, and the main browser workflows.

### 🖥️ Desktop Packaging
The same frontend stays fully web-based and can also be packaged as a native desktop app through [Tauri](https://v2.tauri.app/start/frontend/).

```bash
npm install
npm run tauri:dev
npm run tauri:build
npm run tauri:build:mac:universal
npm run desktop:build:linux
npm run desktop:build:windows
```

`npm run tauri:dev` launches the local static dev server plus the native Tauri shell. `npm run tauri:build` builds the current-host desktop artifacts, `npm run tauri:build:mac:universal` produces a universal macOS app/dmg, `npm run desktop:build:linux` builds Linux artifacts inside Docker, and `npm run desktop:build:windows` attempts a Windows installer build inside Docker/tooling where available.

### 🐳 Docker Web Runtime
You can run the web edition inside Docker and expose it on port `8585` for local or LAN access:

```bash
npm install
npm run docker:web:amd64
npm run docker:web:arm64
docker compose -f compose.yaml up -d
```

The bundled HTTPS server listens on `0.0.0.0:8585`, so the app is reachable at `https://localhost:8585` on the host machine and from other devices on the same network when firewall rules allow it.

You can use the included [`compose.yaml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/compose.yaml>) file directly:

```bash
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml logs -f
docker compose -f compose.yaml down
```

### Secure Chat, TURN, and Web Push
The chat tab has two connection layers:

- **Server URL** is the HTTPS origin that serves the app and proxies `/peerjs`, `/chat-signal`, `/turn-config`, and `/push/*`. For LAN use, enter the host LAN address. For internet use, enter your TLS domain.
- **TURN URL / TURN user / TURN password** come from Docker environment variables. Copy `docker-compose.env.example` to `.env`, set `TURN_USER`, `TURN_PASSWORD`, and `CHAT_TURN_URL`, then start with the TURN profile:

```bash
cp docker-compose.env.example .env
npx web-push generate-vapid-keys
docker compose -f compose.yaml --profile turn up -d --build
```

For internet clients, `CHAT_TURN_URL` must point to a reachable IP/domain, for example `turn:chat.example.com:3478?transport=udp` or `turns:chat.example.com:5349?transport=tcp`. Web Push requires stable `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; otherwise subscriptions are temporary for that container run.

If you want to run the prebuilt Docker archives from [`artifacts/docker`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker>), load and start the image like this:

```bash
docker load -i artifacts/docker/poorija-cryptography-web-amd64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-amd64
```

For full Docker setup and LAN access instructions, see [`DOCKER_GUIDE.md`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/DOCKER_GUIDE.md>).

---

<a name="فارسی"></a>
<div dir="rtl" align="right">

## 🇮🇷 فارسی

### 🌟 معرفی
**سوئیت پیشرفته رمزنگاری P00RIJÃ 2.80** یک داشبورد رمزنگاری کاملاً سمت کاربر است که برای رمزنگاری امن متن و فایل، مدیریت کلید، اشتراک امن، امضای دیجیتال، یادداشت امن و اجرای وب/PWA/داکر/دسکتاپ طراحی شده است. تمام عملیات حساس برنامه روی دستگاه کاربر انجام می‌شوند.

### ✨ امکانات
*   🔐 **رمزنگاری و رمزگشایی متن و فایل:** پیام‌ها و فایل‌های خود را با استفاده از الگوریتم‌های مدرن Web Crypto به‌صورت امن رمزنگاری و رمزگشایی کنید.
*   🧩 **کاتالوگ استاندارد الگوریتم‌های Web Crypto:** مسیرهای جدید برنامه بر پایه `AES-GCM`، `AES-CTR`، `AES-CBC` برای سازگاری، و مدل هیبریدی `RSA-OAEP-3072/4096 + AES-256-GCM` با طول کلید واقعی هر الگوریتم اجرا می‌شوند.
*   🔄 **مهاجرت خودکار داده‌های قدیمی:** تنظیمات و رکوردهای کلید قدیمی به‌صورت خودکار نرمال می‌شوند تا داده‌های ذخیره‌شده‌ی نسخه‌های قبلی بدون پاک‌سازی دستی با مدل جدید هماهنگ شوند.
*   🔓 **ورود با Passkey / Biometric:** باز کردن سریع برنامه با WebAuthn روی مرورگرها و دستگاه‌های سازگار.
*   🪪 **پرامپت بایومتریک دسکتاپ:** در نسخه دسکتاپ، اگر platform authenticator در دسترس باشد، برنامه یک‌بار پیشنهاد فعال‌سازی quick unlock محلی را نمایش می‌دهد.
*   🔑 **تولیدکننده پیشرفته رمز عبور:** رمزهای عبور فوق امن و تصادفی با معیارهای قابل تنظیم (طول، حروف، اعداد، علائم و تعیین کاراکتر شروع و پایان) و سنجش قدرت تولید کنید.
*   🗄️ **مدیریت کلیدها:** کلیدهای رمزنگاری خود را به صورت محلی در مرورگر خود ذخیره و مدیریت کنید.
*   📝 **یادداشت‌های امن:** یادداشت‌های خصوصی رمزنگاری‌شده را داخل برنامه ذخیره کنید و در صورت نیاز آن‌ها را به باندل امن تبدیل کنید.
*   💬 **چت امن:** پیام‌رسان داخلی با طراحی ساده‌تر شبیه اپ‌های محبوب، تاریخچه محلی، چت مستقیم، گروه/کانال محلی، ارسال فایل، پیام صوتی، پیام زمان‌دار، تیک ارسال/تحویل/مشاهده، ری‌اکشن، تاریخچه تماس و تماس صوتی/تصویری. ارتباط مستقیم با WebRTC انجام می‌شود و رله فقط بسته‌های رمزنگاری‌شده و اعلان Push را نگه می‌دارد.
*   🔗 **اشتراک امن:** برای متن، یادداشت، فایل کوچک و کلید عمومی، لینک یا باندل رمزنگاری‌شده با انقضا و محدودیت مشاهده بسازید.
*   ✍️ **امضای دیجیتال:** با `ECDSA-P256`، `ECDSA-P384` و `RSA-PSS-3072` برای متن و فایل امضا بسازید و verify کنید.
*   🩺 **مرکز سلامت امنیت:** passkey، 2FA، بکاپ، رمزهای ضعیف/تکراری و کلیدهای legacy را در یک داشبورد بررسی کنید.
*   🧭 **ویزارد هوشمند:** برای سناریوهای رایج مثل encrypt-for-self، share securely، sign/verify و self-destruct مسیر آماده دارد.
*   🚀 **سیستم مهاجرت (Migration):** از تمامی کلیدها، رمزها و تنظیمات خود خروجی رمزنگاری شده بگیرید و در سیستم دیگر وارد کنید.
*   🖼️ **پنهان‌نگاری (Steganography):** متن‌های محرمانه خود را داخل تصاویر بدون تغییر ظاهری عکس مخفی کنید.
*   ♻️ **امحای امن فایل:** فایل‌های خود را به صورت امن با صفرنویسی (Zero-byte overwrite) غیرقابل بازیابی کنید.
*   🔡 **تنظیمات فونت و نوشتار:** فونت فارسی و انگلیسی دلخواه و اندازه متن برنامه را تنظیم کنید.
*   🛡️ **تایید دو مرحله‌ای (2FA):** امنیت خود را با ادغام 2FA مبتنی بر TOTP افزایش دهید.
*   🧭 **ناوبری داشبوردی:** منوی برنامه در دسکتاپ به sidebar عمودی تبدیل شده و در موبایل و تبلت به صورت drawer همبرگری نمایش داده می‌شود.
*   🧷 **چیدمان بهتر صفحه شروع و بازیابی:** صفحه ثبت اولیه حالا ستون‌های عریض‌تر برای رمز مستر و سوالات امنیتی دارد و بخش شرایط استفاده، لایسنس GPL و صلب مسئولیت نیز به آن اضافه شده است.
*   🖼️ **پروفایل آیکون دسکتاپ:** در نسخه دسکتاپ می‌توان بین آیکون اصلی، تم‌های سپر جایگزین و چند پروفایل بصری کم‌جلب‌توجه جابه‌جا شد.
*   🐳 **نسخه داکر تحت وب:** برنامه می‌تواند داخل کانتینر Docker روی پورت `8585` اجرا شود و برای معماری‌های `amd64` و `arm64` ایمیج جداگانه دارد تا از طریق مرورگر روی سیستم محلی یا شبکه در دسترس باشد.
*   ✨ **انیمیشن و تم‌های جدید:** ترنزیشن‌های سرتاسری، افکت‌های ambient و تم‌های تازه مثل Aurora، Sunset، Linen و Obsidian به مجموعه قبلی اضافه شده‌اند.
*   📲 **PWA قابل نصب:** برنامه حالا manifest، service worker، prompt نصب و shortcutهای سریع دارد.
*   ⏱️ **قفل خودکار سفارشی:** می‌توانید مدت زمان دلخواه برای قفل شدن خودکار برنامه پس از عدم فعالیت تنظیم کنید.
*   🌐 **رابط کاربری دو زبانه:** پشتیبانی کامل از زبان‌های انگلیسی و فارسی با ترجمه کامل و رفع مشکل انیمیشن سوییچ‌ها در حالت راست‌چین.
*   🚀 **فقط سمت کاربر:** نیازی به سرور بک‌اند نیست. تمام عملیات به صورت محلی با استفاده از جاوا اسکریپت انجام می‌شود.

### 🚀 نحوه اجرا
از آنجایی که برنامه کاملاً سمت کاربر است، هیچ وابستگی سروری برای نصب وجود ندارد.

1.  مخزن را کلون کنید یا کد منبع را دانلود کنید.
2.  فایل `index.html` را مستقیماً در هر مرورگر وب مدرنی باز کنید.
    *   *به عنوان روش جایگزین، می‌توانید یک وب سرور محلی ساده (مانند `python -m http.server`) را اجرا کرده و به آدرس محلی بروید.*

### 🧪 تست
مسیر فعلی تست‌ها کاملاً بر پایه ابزارهای Node.js خود پروژه است:
<div dir="ltr" align="left">

```bash
npm install
npm test
npm run test:smoke
```

</div>

`npm test` تست واحد کاتالوگ الگوریتم‌ها را اجرا می‌کند و `npm run test:smoke` با اجرای یک سرور محلی و Playwright، مهاجرت legacy، export/import بکاپ، داشبورد واکنش‌گرا، ویزارد هوشمند، security center، یادداشت امن، secure share، امضای دیجیتال، passkey quick unlock، مسیرهای متن AES/RSA، پیام خودتخریب، و round-trip فایل در حالت‌های `password`، `stored-secret` و `RSA` را به‌صورت انتها‌به‌انتها بررسی می‌کند.

### 🖥️ بسته‌بندی دسکتاپ
همین فرانت‌اند می‌تواند هم‌زمان نسخه وب بماند و به‌صورت اپ بومی برای macOS، Windows و Linux بسته‌بندی شود. مسیر پیشنهادی، [Tauri](https://v2.tauri.app/start/frontend/) است؛ چون در مستندات رسمی‌اش دقیقاً برای میزبانی یک فرانت‌اند استاتیک HTML/CSS/JavaScript موجود در یک پوسته دسکتاپ سبک معرفی شده است.

<div dir="ltr" align="left">

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

</div>

`npm run tauri:dev` سرور محلی استاتیک را به همراه پوسته‌ی بومی Tauri اجرا می‌کند. `npm run tauri:build` خروجی دسکتاپ سیستم‌عامل فعلی را می‌سازد، `npm run tauri:build:mac:universal` نسخه یونیورسال macOS را تولید می‌کند، `npm run desktop:build:linux` بسته‌های لینوکس را در Docker می‌سازد، و `npm run desktop:build:windows` تلاش می‌کند خروجی ویندوز را با tooling بین‌پلتفرمی آماده کند.

### 🐳 اجرای وب با Docker
اگر بخواهید نسخه‌ی وب را داخل Docker اجرا کنید و آن را روی پورت `8585` در اختیار سیستم محلی یا شبکه قرار بدهید، این مسیر آماده است:

<div dir="ltr" align="left">

```bash
npm install
npm run docker:web:amd64
npm run docker:web:arm64
docker compose -f compose.yaml up -d
```

</div>

سرور HTTPS داخل کانتینر روی `0.0.0.0:8585` گوش می‌دهد؛ بنابراین برنامه از روی همان سیستم با `https://localhost:8585` و از دستگاه‌های دیگر شبکه محلی نیز در صورت باز بودن فایروال در دسترس خواهد بود.

فایل آماده‌ی [`compose.yaml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/compose.yaml>) هم داخل پروژه قرار دارد و می‌توانید مستقیم از آن استفاده کنید:

<div dir="ltr" align="left">

```bash
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml logs -f
docker compose -f compose.yaml down
```

### چت امن، TURN و اعلان Push
در تب چت دو بخش اتصال وجود دارد:

*   **Server URL:** همان آدرس HTTPS برنامه/رله است که مسیرهای `/peerjs`، `/chat-signal`، `/turn-config` و `/push/*` را سرو می‌کند. در شبکه محلی IP همان سیستم میزبان را وارد کنید و برای اینترنت دامنه TLSدار را بگذارید.
*   **TURN URL / TURN User / TURN Password:** از فایل `.env` خوانده می‌شود. فایل `docker-compose.env.example` را به `.env` کپی کنید، مقدارهای `TURN_USER`، `TURN_PASSWORD` و `CHAT_TURN_URL` را تنظیم کنید و سپس با profile زیر اجرا کنید:

<div dir="ltr" align="left">

```bash
cp docker-compose.env.example .env
npx web-push generate-vapid-keys
docker compose -f compose.yaml --profile turn up -d --build
```

</div>

برای کاربران خارج از شبکه، مقدار `CHAT_TURN_URL` باید یک IP یا دامنه قابل دسترس باشد؛ مثل `turn:chat.example.com:3478?transport=udp` یا `turns:chat.example.com:5349?transport=tcp`. برای اعلان‌های سیستم‌عامل هم بهتر است `VAPID_PUBLIC_KEY` و `VAPID_PRIVATE_KEY` ثابت در `.env` بگذارید.

</div>

اگر بخواهید از imageهای از قبل آماده‌شده در [`artifacts/docker`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker>) استفاده کنید، ابتدا آن‌ها را load و بعد اجرا کنید:

<div dir="ltr" align="left">

```bash
docker load -i artifacts/docker/poorija-cryptography-web-amd64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-amd64
```

</div>

راهنمای کامل Docker، اجرای `amd64/arm64` و دسترسی از شبکه محلی در [`DOCKER_GUIDE.md`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/DOCKER_GUIDE.md>) آمده است.
</div>
