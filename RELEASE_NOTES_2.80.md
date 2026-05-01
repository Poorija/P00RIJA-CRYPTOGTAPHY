# P00RIJA Cryptography 2.80 Release Notes

## Summary
P00RIJA Cryptography 2.80 finalizes the client-side cryptography dashboard refresh across web, Docker, and desktop packaging.

## Highlights
- Refined the first-run registration screen with wider setup columns, cleaner Persian layout behavior, and a structured terms/license/disclaimer section.
- Added advanced encryption controls for both password-based and public-key workflows, including PBKDF2 hash/iterations, salt length, AES-GCM tag length, AES-CTR counter length, AAD/context, and RSA-OAEP labels.
- Added sortable and filterable encryption/decryption history with search, algorithm filters, and multiple sort orders.
- Hardened desktop runtime behavior for local authentication, file shredding, dialog access, and system-notification permission handling.
- Removed redundant sidebar install promo content and tightened the dashboard header sizing for a cleaner UI.
- Updated web, desktop, and Docker delivery paths under version 2.80.

## Security and Compatibility
- Legacy settings, keys, and payloads still migrate forward automatically where possible.
- Desktop quick unlock now retries runtime bridge detection before falling back to an unavailable state.
- Native desktop file shredding remains separate from the browser-only File System Access API flow.
- Translation parity between Persian and English is checked programmatically.

## Deliverables
- Web source
- Docker runtime (`amd64` and `arm64`)
- macOS Universal app and DMG
- Windows x64 installer
- Linux DEB
- Linux RPM
- Linux AppImage
- Linux Arch package (`pkg.tar.zst`)

## Notes
- Desktop packages are usable without commercial signing certificates.
- macOS may still show Gatekeeper warnings and Windows may still show SmartScreen warnings because public-distribution signing/notarization is not included.

## فارسی

### خلاصه
نسخه 2.80 جمع‌بندی نهایی بازطراحی داشبورد رمزنگاری سمت کاربر P00RIJA برای وب، داکر و دسکتاپ است.

### مهم‌ترین تغییرات
- اصلاح صفحه شروع و ثبت‌نام با ستون‌های عریض‌تر، رفتار بهتر در فارسی، و بخش منظم شرایط استفاده/لایسنس/صلب مسئولیت
- اضافه شدن تنظیمات تخصصی‌تر رمزنگاری برای حالت رمز عبور و کلید عمومی، شامل تکرار و هش PBKDF2، طول Salt، طول Tag در AES-GCM، طول شمارنده در AES-CTR، رشته AAD/Context و برچسب RSA-OAEP
- اضافه شدن فیلتر و مرتب‌سازی تاریخچه رمزنگاری/رمزگشایی با جستجو، فیلتر الگوریتم و چندین حالت sort
- بهبود رفتار runtime دسکتاپ برای احراز هویت محلی، امحای فایل، دسترسی به دیالوگ‌ها و دریافت اجازه اعلان‌های سیستمی
- حذف کارت اضافی نصب از سایدبار و کوچک‌تر شدن هدر داشبورد برای ظاهر تمیزتر
- به‌روزرسانی مسیرهای تحویل وب، دسکتاپ و Docker تحت نسخه 2.80

### امنیت و سازگاری
- تنظیمات، کلیدها و payloadهای قدیمی همچنان تا حد ممکن به‌صورت خودکار migrate می‌شوند.
- ورود سریع دسکتاپ پیش از اعلام عدم پشتیبانی، چند بار runtime bridge را دوباره بررسی می‌کند.
- امحای فایل در دسکتاپ همچنان مستقل از File System Access API مرورگر انجام می‌شود.
- هم‌ترازی ترجمه فارسی و انگلیسی به‌صورت ماشینی بررسی می‌شود.

### خروجی‌ها
- سورس وب
- runtime داکر (`amd64` و `arm64`)
- اپ و DMG یونیورسال macOS
- نصب‌کننده x64 ویندوز
- بسته DEB لینوکس
- بسته RPM لینوکس
- AppImage لینوکس
- بسته Arch با فرمت `pkg.tar.zst`

### نکات
- بسته‌های دسکتاپ بدون گواهی امضای تجاری هم قابل استفاده هستند.
- macOS و Windows ممکن است به دلیل نبود signing/notarization عمومی هنوز هشدار امنیتی نمایش دهند.
