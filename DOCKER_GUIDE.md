# Docker Guide

## English

### Overview
This project can run as a browser-accessible Docker container based on Ubuntu. The built-in static server listens on `0.0.0.0:2585`, so the app is reachable from:

- The same machine: `http://localhost:2585`
- Other devices on the same LAN: `http://YOUR_LOCAL_IP:2585`

### Files
- Docker image definition: [`Dockerfile`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/Dockerfile>)
- Compose file: [`compose.yaml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/compose.yaml>)
- Legacy-compatible compose alias: [`docker-compose.yml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/docker-compose.yml>)
- Prebuilt image archives:
  - [`artifacts/docker/poorija-cryptography-web-amd64.tar.gz`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker/poorija-cryptography-web-amd64.tar.gz>)
  - [`artifacts/docker/poorija-cryptography-web-arm64.tar.gz`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker/poorija-cryptography-web-arm64.tar.gz>)

### Option 1: Run with Docker Compose
```bash
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml logs -f
docker compose -f compose.yaml down
```

### Option 2: Load a Prebuilt Image Archive
For `x86_64 / amd64` systems:
```bash
docker load -i artifacts/docker/poorija-cryptography-web-amd64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-amd64
```

For `arm64` systems:
```bash
docker load -i artifacts/docker/poorija-cryptography-web-arm64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-arm64
```

### Option 3: Build Locally
```bash
npm run docker:web:amd64
npm run docker:web:arm64
```

### LAN Access
1. Find your machine's local IP address.
2. Make sure port `2585` is allowed by your firewall.
3. Open `http://YOUR_LOCAL_IP:2585` from another device on the same network.

### Stop and Remove
```bash
docker stop poorija-cryptography
docker rm poorija-cryptography
```

---

## فارسی

### معرفی
این پروژه می‌تواند به‌صورت یک کانتینر Docker مبتنی بر Ubuntu اجرا شود و از طریق مرورگر در دسترس باشد. سرور استاتیک داخلی روی `0.0.0.0:2585` گوش می‌دهد، بنابراین برنامه از این مسیرها در دسترس است:

- روی همان سیستم: `http://localhost:2585`
- روی دستگاه‌های دیگر شبکه محلی: `http://IP_محلی_شما:2585`

### فایل‌ها
- تعریف image داکر: [`Dockerfile`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/Dockerfile>)
- فایل اجرای Compose: [`compose.yaml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/compose.yaml>)
- فایل سازگار قدیمی‌تر: [`docker-compose.yml`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/docker-compose.yml>)
- آرشیو imageهای آماده:
  - [`artifacts/docker/poorija-cryptography-web-amd64.tar.gz`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker/poorija-cryptography-web-amd64.tar.gz>)
  - [`artifacts/docker/poorija-cryptography-web-arm64.tar.gz`](</Users/p00rija/Programming Projects/P00RIJA/P00RIJA-Cryptography/P00RIJA-Cryptography-fix-algorithm-selections-and-webcrypto-3158997588651176840/artifacts/docker/poorija-cryptography-web-arm64.tar.gz>)

### روش ۱: اجرا با Docker Compose
```bash
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml logs -f
docker compose -f compose.yaml down
```

### روش ۲: اجرای image آماده
برای سیستم‌های `amd64 / x86_64`:
```bash
docker load -i artifacts/docker/poorija-cryptography-web-amd64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-amd64
```

برای سیستم‌های `arm64`:
```bash
docker load -i artifacts/docker/poorija-cryptography-web-arm64.tar.gz
docker run -d --name poorija-cryptography -p 2585:2585 poorija-cryptography:web-arm64
```

### روش ۳: ساخت image روی سیستم خودتان
```bash
npm run docker:web:amd64
npm run docker:web:arm64
```

### دسترسی از شبکه محلی
1. IP محلی سیستم خود را پیدا کنید.
2. مطمئن شوید پورت `2585` در فایروال باز است.
3. از دستگاه دیگر روی همان شبکه، آدرس `http://IP_محلی_شما:2585` را باز کنید.

### توقف و حذف کانتینر
```bash
docker stop poorija-cryptography
docker rm poorija-cryptography
```
