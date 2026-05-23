# Báo cáo thông tin đã mua VPS phục vụ triển khai hệ thống OKR nội bộ

> **Mục đích tài liệu:** Ghi nhận thông tin gói VPS đã mua, cấu hình hiện tại, chi phí, lý do lựa chọn và phương án sử dụng trong giai đoạn test/deploy hệ thống web nội bộ của Xưởng Điều khiển.
> **Lưu ý bảo mật:** Tài liệu này có chứa thông tin hạ tầng như IP máy chủ. Chỉ nên lưu hành nội bộ, không đăng công khai.

---

## 1. Tóm tắt quyết định mua

Hiện đã mua gói **VPS NVMe 2** để sử dụng thử nghiệm trong giai đoạn đầu. Mục tiêu là dùng VPS này để triển khai và kiểm thử hệ thống web nội bộ trước khi quyết định cấu hình vận hành lâu dài.

Phương án hiện tại:

```text
Giai đoạn 1: Dùng VPS NVMe 2 trong 01 tháng để test triển khai
Giai đoạn 2: Nếu hệ thống chạy ổn và tải thực tế nhẹ, cân nhắc chuyển sang VPS Cheap 4 để tối ưu chi phí
```

Lý do chọn **VPS NVMe 2** ở giai đoạn đầu:

- Có hiệu năng ổ đĩa NVMe cao hơn dòng VPS Cheap.
- Phù hợp để test triển khai Docker, database, backend, frontend và các tác vụ build/deploy.
- Chu kỳ chỉ **01 tháng**, hạn chế rủi ro chi phí dài hạn.
- Có thể chuyển đổi sang dòng VPS Cheap về sau theo thông tin tư vấn từ nhà cung cấp.

---

## 2. Thông tin gói VPS đã mua

| Hạng mục | Thông tin |
|---|---|
| Nhà cung cấp | Vietnix |
| Dòng dịch vụ | VPS NVMe |
| Gói dịch vụ | **VPS NVMe 2** |
| Trạng thái | Đang sử dụng |
| Tên máy chủ / Hostname | `okr-server-mbns-onpt` |
| IP chính | `103.200.20.225` |
| Username SSH ban đầu | `root` |
| Port SSH | `22` |
| Mật khẩu SSH ban đầu | Đã được nhà cung cấp cấp riêng, không ghi trực tiếp trong tài liệu repo |
| Ngày đăng ký | 22/05/2026 |
| Ngày hết hạn | 22/06/2026 |
| Chu kỳ thanh toán | 01 tháng |

---

## 3. Cấu hình kỹ thuật VPS

| Thành phần | Cấu hình |
|---|---|
| CPU | 2 CPU AMD EPYC |
| RAM | 4 GB |
| Ổ cứng | 40 GB NVMe |
| Hệ điều hành | Ubuntu 22.04 LTS x64 |
| IOPS | Read 90k / Write 30k |
| Băng thông trong nước | 400 Mbps |
| Băng thông quốc tế | 400 Mbps Inbound / 10 Mbps Outbound |
| Data transfer | Không giới hạn |
| Backup mặc định | Tự động 1 lần/tuần |
| Dịch vụ backup trả phí | Chưa mua thêm |
| Quyền quản trị | Root/SSH, toàn quyền quản trị VPS |

---

## 4. Thông tin mạng và trạng thái ban đầu

| Hạng mục | Thông tin |
|---|---|
| IP Address | `103.200.20.225` |
| SSH | `root@103.200.20.225 -p 22` |
| Subnet Mask | `255.255.255.0` |
| Gateway | `103.200.20.1` |
| Nameserver 1 | `8.8.8.8` |
| Nameserver 2 | `1.1.1.1` |
| Trạng thái VPS | Running |
| Boot order | `virtio0` |
| Root Disk | 40 GB |
| Network Rate hiển thị | 51 MB/s, tương đương khoảng 408 Mbps |

Tại thời điểm vừa khởi tạo, hệ thống hiển thị mức sử dụng tài nguyên ban đầu:

| Tài nguyên | Mức sử dụng ban đầu |
|---|---|
| CPU | 0.00% / 2 cores |
| RAM | Khoảng 404.58 MB / 4 GiB |
| Disk | Chưa phát sinh dữ liệu đáng kể |
| Bandwidth | 0 MB / Unlimited |

---

## 5. Mục đích sử dụng VPS

VPS này được dùng để triển khai thử nghiệm hệ thống web nội bộ, dự kiến bao gồm:

- Frontend React/Vite.
- Backend Python FastAPI.
- Database PostgreSQL hoặc MySQL/MariaDB tùy phương án triển khai.
- Nginx reverse proxy.
- Docker Compose để quản lý các service.
- Storage cho file upload, export Excel, backup dữ liệu.
- Các công cụ nội bộ có thể bổ sung sau này.

Mục tiêu ban đầu là xác minh:

1. Ứng dụng có chạy ổn trên VPS không.
2. Tài nguyên CPU/RAM/disk có đủ cho khoảng 50 người dùng nội bộ không.
3. Tốc độ truy cập trong mạng công ty có ổn không.
4. Quy trình deploy, backup, update code có thuận tiện không.
5. Có cần duy trì VPS NVMe hay có thể chuyển sang VPS Cheap 4 để tiết kiệm chi phí.

---

## 6. Kế hoạch chuyển đổi sang VPS Cheap 4 sau giai đoạn test

Theo thông tin trao đổi với nhà cung cấp, việc chuyển từ **VPS NVMe 2** sang **VPS Cheap 4** là khả thi.

Các điểm đã được nhà cung cấp xác nhận:

| Nội dung | Thông tin xác nhận |
|---|---|
| Có hỗ trợ chuyển từ VPS NVMe sang VPS Cheap | Có |
| Có giữ nguyên IP khi chuyển gói | Có |
| Có giữ nguyên dữ liệu không | Có, nếu dung lượng ổ cứng gói mới bằng hoặc lớn hơn gói cũ |
| Trường hợp NVMe 2 → Cheap 4 | NVMe 2 có 40 GB, Cheap 4 có 60 GB nên không ảnh hưởng dữ liệu theo phản hồi của nhà cung cấp |
| Cách chuyển | Chuyển đổi trên chính VPS đang sử dụng |
| Downtime dự kiến | Khoảng 35–40 phút |
| Phí kỹ thuật chuyển đổi | Không phát sinh |
| Quyền root/SSH trên VPS Cheap | Vẫn có đầy đủ |
| Toàn quyền cài ứng dụng trên VPS Cheap | Có |

Dù nhà cung cấp xác nhận không mất dữ liệu trong trường hợp ổ mới lớn hơn ổ cũ, vẫn cần thực hiện backup trước khi chuyển gói.

---

## 7. So sánh định hướng: VPS NVMe 2 và VPS Cheap 4

| Tiêu chí | VPS NVMe 2 hiện tại | VPS Cheap 4 dự kiến |
|---|---:|---:|
| CPU | 2 CPU AMD EPYC | 4 vCPU E5 v2 |
| RAM | 4 GB | 6 GB |
| Ổ cứng | 40 GB NVMe | 60 GB SSD |
| IOPS | Read 90k / Write 30k | Read 9k / Write 3k |
| Băng thông trong nước | 400 Mbps | 100 Mbps |
| Băng thông quốc tế | 400 Mbps inbound / 10 Mbps outbound | 10 Mbps inbound / 10 Mbps outbound |
| Chi phí | Cao hơn | Thấp hơn nếu mua chu kỳ 3 tháng |
| Phù hợp | Test, deploy ban đầu, hiệu năng tốt hơn | Vận hành tiết kiệm nếu hệ thống nhẹ |

Nhận xét:

- **VPS NVMe 2** có lợi thế lớn về tốc độ ổ cứng và băng thông, phù hợp cho giai đoạn test, build, deploy và kiểm thử hiệu năng.
- **VPS Cheap 4** có RAM và dung lượng ổ cứng lớn hơn, chi phí thấp hơn, phù hợp nếu ứng dụng thực tế không cần I/O cao.
- Với hệ thống nội bộ khoảng 50 người dùng, nếu workload chủ yếu là nhập liệu, dashboard, upload/export file nhẹ, VPS Cheap 4 có khả năng đáp ứng tốt.
- Nếu hệ thống phát sinh nhiều tác vụ đọc/ghi database, xử lý Excel nặng, export lớn hoặc nhiều công cụ chạy đồng thời, VPS NVMe 2 hoặc dòng NVMe vẫn an toàn hơn.

---

## 8. Kế hoạch triển khai kỹ thuật tiếp theo

### 8.1. Kiểm tra truy cập VPS

Sau khi nhận thông tin root/password hoặc SSH key từ nhà cung cấp, kiểm tra truy cập:

```bash
ssh root@103.200.20.225
```

Sau khi đăng nhập thành công, kiểm tra hệ điều hành:

```bash
lsb_release -a
uname -a
```

### 8.2. Cập nhật hệ thống

```bash
apt update && apt upgrade -y
```

### 8.3. Cài các công cụ cơ bản

```bash
apt install -y git curl wget unzip htop nano ufw
```

### 8.4. Cài Docker và Docker Compose

```bash
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Kiểm tra Docker:

```bash
docker --version
docker compose version
```

### 8.5. Cấu hình firewall cơ bản

Mở SSH, HTTP, HTTPS:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

### 8.6. Clone source code

```bash
mkdir -p /opt/okr-system
cd /opt/okr-system
git clone <repo-url> .
```

### 8.7. Tạo file môi trường production

Ví dụ:

```bash
nano .env.production
```

Các biến cần chú ý:

```text
OKR_ENVIRONMENT=production
OKR_DATABASE_URL=postgresql://okr:<password>@postgres:5432/okr_automation
OKR_JWT_SECRET=<random-secret>
OKR_ALLOWED_ORIGINS=http://103.200.20.225
OKR_STORAGE_DIR=/app/storage
```

Nếu sau này dùng subdomain công ty, đổi:

```text
OKR_ALLOWED_ORIGINS=https://okr.<domain-cong-ty>
```

### 8.8. Deploy bằng Docker Compose

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Kiểm tra service:

```bash
docker compose ps
docker compose logs -f
```

### 8.9. Chạy migration database

```bash
docker compose exec backend alembic upgrade head
```

### 8.10. Kiểm tra truy cập web

Ban đầu có thể truy cập bằng IP:

```text
http://103.200.20.225
```

Sau khi ổn định, có thể nhờ IT công ty trỏ subdomain về IP này, ví dụ:

```text
okr.<domain-cong-ty> → 103.200.20.225
```

---

## 9. Checklist bảo mật sau khi mua VPS

Trước khi đưa hệ thống vào sử dụng thật, cần kiểm tra các điểm sau:

- [ ] Đổi password root nếu nhà cung cấp cấp password mặc định.
- [ ] Tạo user quản trị riêng, hạn chế dùng root trực tiếp.
- [ ] Cấu hình SSH key.
- [ ] Cân nhắc tắt đăng nhập SSH bằng password sau khi đã có SSH key.
- [ ] Bật firewall, chỉ mở các port cần thiết.
- [ ] Không mở port database PostgreSQL/MySQL ra Internet.
- [ ] Đổi JWT secret sang chuỗi random mạnh.
- [ ] Đổi password database production.
- [ ] Không đưa file `.env` chứa secret lên Git.
- [ ] Rotate API key nếu key cũ từng bị đưa vào repo hoặc chia sẻ.
- [ ] Cấu hình HTTPS khi có domain/subdomain.
- [ ] Thiết lập backup database định kỳ.

---

## 10. Kế hoạch backup đề xuất

Trong giai đoạn test:

- Có thể chưa cần mua dịch vụ backup trả phí.
- Vẫn nên tạo backup thủ công trước các lần deploy quan trọng.

Khi đưa vào sử dụng thật:

| Đối tượng | Tần suất đề xuất | Cách thực hiện |
|---|---|---|
| Database | Hằng ngày | `pg_dump` hoặc `mysqldump` |
| File upload/export | Hằng tuần | Nén thư mục storage và copy ra nơi khác |
| File cấu hình `.env.production` | Khi thay đổi | Lưu bản nội bộ an toàn |
| Full server snapshot | Trước khi chuyển gói hoặc nâng cấp lớn | Dùng backup/snapshot của nhà cung cấp nếu có |

Ví dụ backup PostgreSQL:

```bash
mkdir -p /backup/postgres
docker compose exec -T postgres pg_dump -U okr okr_automation | gzip > /backup/postgres/okr_$(date +%Y%m%d).sql.gz
```

---

## 11. Kết luận

Việc mua **VPS NVMe 2** trong 01 tháng để test là phương án hợp lý. Gói này có hiệu năng tốt, đủ quyền root/SSH, sử dụng Ubuntu 22.04 LTS và phù hợp để triển khai thử hệ thống web nội bộ theo mô hình server riêng.

Sau giai đoạn test, nếu hệ thống không sử dụng nhiều tài nguyên, có thể chuyển sang **VPS Cheap 4** để tối ưu chi phí. Nhà cung cấp đã xác nhận việc chuyển từ VPS NVMe sang VPS Cheap có thể giữ nguyên IP và không ảnh hưởng dữ liệu nếu dung lượng ổ cứng gói mới bằng hoặc lớn hơn gói cũ. Với trường hợp **NVMe 2 40GB → Cheap 4 60GB**, điều kiện này được đáp ứng.

Khuyến nghị hiện tại:

```text
1. Tiếp tục dùng VPS NVMe 2 để deploy thử nghiệm.
2. Cấu hình Docker, firewall, backup cơ bản.
3. Test ứng dụng bằng IP trước.
4. Theo dõi CPU/RAM/disk trong 2–4 tuần.
5. Nếu tài nguyên dư và hệ thống ổn định, chuyển sang VPS Cheap 4 để giảm chi phí.
6. Trước khi chuyển gói, bắt buộc backup database và thư mục storage.
```

---

## 12. Phụ lục: Thông tin cần lưu riêng

Các thông tin sau không nên ghi trực tiếp trong tài liệu chia sẻ rộng rãi:

- Mật khẩu root VPS.
- Private SSH key.
- Database password.
- JWT secret.
- API key LLM.
- File `.env.production`.
- Token truy cập Git repository.

Nên lưu các thông tin này trong nơi quản lý mật khẩu nội bộ hoặc file bảo mật riêng có giới hạn quyền truy cập.
