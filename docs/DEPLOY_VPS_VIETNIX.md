# Deploy OKR lên VPS Vietnix

VPS hiện tại:

- IP: `103.200.20.225`
- Domain: `xdk-pvcfc.com`
- OS: Ubuntu 22.04 LTS
- Cấu hình: 2 CPU, 4 GB RAM, 40 GB NVMe

Mô hình deploy:

- `caddy`: reverse proxy public cổng `80`/`443`, tự cấp và gia hạn HTTPS.
- `frontend`: React/Vite build static, chạy bằng Nginx nội bộ trong Docker network.
- `backend`: FastAPI, chỉ nằm trong Docker network.
- `postgres`: database production, không mở port ra Internet.
- `redis`: cache, không mở port ra Internet.
- `storage/`: bind mount từ host vào container để giữ file upload/export.

## 1. Đăng nhập VPS

```bash
ssh root@103.200.20.225
```

## 2. Cập nhật hệ thống và cài công cụ

```bash
apt update && apt upgrade -y
apt install -y git curl wget unzip htop nano ufw ca-certificates gnupg
```

## 3. Cài Docker Engine và Docker Compose plugin

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker --version
docker compose version
```

## 4. Bật firewall cơ bản

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

## 5. Lấy source code

```bash
mkdir -p /opt/okr-system
cd /opt/okr-system
git clone <repo-url> .
```

Nếu repo private, dùng SSH key hoặc access token theo chính sách nội bộ.

## 6. Tạo file môi trường production

```bash
cp .env.production.example .env.production
nano .env.production
```

Bắt buộc đổi các giá trị sau:

```text
POSTGRES_PASSWORD=<password database mạnh>
OKR_JWT_SECRET=<chuỗi random dài>
OKR_BOOTSTRAP_ADMIN_PASSWORD=<mật khẩu admin ban đầu>
```

Có thể tạo secret bằng:

```bash
openssl rand -hex 32
```

Trong giai đoạn chạy bằng IP, giữ:

```text
OKR_ALLOWED_ORIGINS=http://103.200.20.225
```

Khi dùng domain `xdk-pvcfc.com`, dùng:

```text
OKR_ALLOWED_ORIGINS=http://xdk-pvcfc.com,https://xdk-pvcfc.com,http://www.xdk-pvcfc.com,https://www.xdk-pvcfc.com,http://103.200.20.225
```

## 7. Chạy hệ thống

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Kiểm tra:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
curl http://127.0.0.1/health
```

Mở trình duyệt:

```text
https://xdk-pvcfc.com
```

Tài khoản admin ban đầu là giá trị `OKR_BOOTSTRAP_ADMIN_ID` và `OKR_BOOTSTRAP_ADMIN_PASSWORD` trong `.env.production`. Tài khoản này chỉ được seed khi database còn trống.

## 8. Cập nhật phiên bản mới

```bash
cd /opt/okr-system
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## 9. Backup thủ công

```bash
mkdir -p /backup/okr
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U okr okr_automation | gzip > /backup/okr/okr_$(date +%Y%m%d).sql.gz

tar -czf /backup/okr/storage_$(date +%Y%m%d).tar.gz storage
```

Nên chạy backup trước mỗi lần update lớn hoặc trước khi chuyển gói VPS.

## 10. Dừng hệ thống

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Không dùng `docker compose down -v` trừ khi muốn xóa toàn bộ dữ liệu database.
