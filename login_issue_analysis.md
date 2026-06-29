# Phân tích lỗi đăng nhập với mật khẩu mặc định `PVCFC@123`

## Kết luận ngắn

Có một nguyên nhân chắc chắn từ code/data: hệ thống có nhiều nguồn tạo user khác nhau, trong đó một số tài khoản demo/legacy không dùng `PVCFC@123`. Ngoài ra deploy mặc định giữ nguyên password của user đã tồn tại, nên nếu DB từng có user với password khác thì deploy thông thường không đưa họ về mật khẩu mặc định.

Phần frontend cũng có một lỗi thực tế trên điện thoại: ô tài khoản chưa tắt auto-capitalization/autocorrect, trong khi backend trước đây lookup user id phân biệt hoa/thường.

Các vấn đề như gõ sai hoa/thường của mật khẩu hoặc bộ gõ tiếng Việt là rủi ro nhập liệu của người dùng, không phải bằng chứng chắc chắn về lỗi project.

## Nguyên nhân chắc chắn

### 1. Account demo/legacy không dùng `PVCFC@123`

Trong `backend/app/services/bootstrap.py`, môi trường development seed các tài khoản demo:

- `admin / admin-pass`
- `leader / leader-pass`
- `fi / fi-pass`
- `TBHTĐK / tbhtdk-pass`
- `TBCH / tbch-pass`
- `TBĐL / tbdl-pass`
- `TCĐK / tcdk-pass`

Các account này khác với danh sách user thật trong `backend/scripts/seed_users_xuong_dk.py`, nơi mật khẩu mặc định là `PVCFC@123`.

Hệ quả: nếu người dùng hoặc admin thử đăng nhập bằng các account demo/legacy nhưng lại dùng `PVCFC@123`, backend sẽ trả `"Sai tài khoản hoặc mật khẩu"` dù account chưa từng đổi mật khẩu.

### 2. Seed production giữ password cũ của user đã tồn tại

`seed_users_xuong_dk.py` chỉ đặt `PVCFC@123` khi tạo user mới. Với user đã tồn tại, script chỉ cập nhật tên/role/team/is_active và chỉ reset password nếu chạy với `--reset-passwords`.

Deploy production hiện mặc định không bật `--reset-passwords`. Đây là quyết định đúng để không ghi đè mật khẩu riêng của user đã đổi, nhưng nó cũng tạo ra vấn đề: user chưa login nhưng đã tồn tại với hash khác sẽ tiếp tục không đăng nhập được bằng `PVCFC@123`.

### 3. Thiếu cơ chế reset chọn lọc theo trạng thái sử dụng

Trước khi bổ sung script an toàn, hệ thống chỉ có hai hướng:

- Không reset gì: bảo toàn password riêng nhưng bỏ sót user chưa login có password sai.
- Reset toàn bộ seed users: sửa được user chưa login nhưng có nguy cơ ghi đè password riêng.

Tiêu chí đúng cần dùng là reset chọn lọc:

- Reset nếu user active, password hiện tại không khớp `PVCFC@123`, không có audit `change_password`, và (`must_change_password=true` hoặc chưa có audit `login`).
- Không reset nếu user đã có audit `change_password`.
- Không reset nếu user đã login và không còn `must_change_password`.
- Không tự reset tài khoản Admin; chỉ báo cáo để xử lý thủ công.

## Lỗi frontend cần sửa

Ô nhập tài khoản trong `frontend/src/app/App.tsx` trước đây chưa khai báo `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`. Trên điện thoại, bàn phím có thể tự đổi `kiaq` thành `Kiaq`.

Backend trước đây lookup trực tiếp:

```python
user = db.get(User, payload.user_id)
```

Vì khóa chính phân biệt hoa/thường, `Kiaq` không tìm được `kiaq`. Cách sửa an toàn là:

- frontend tắt auto-cap/autocorrect/spellcheck cho ô tài khoản;
- backend trim `user_id`, lookup exact trước, sau đó fallback lowercase nếu exact không có;
- không ép lowercase ở frontend để không làm hỏng các account demo/team đang dùng chữ hoa như `TBCH`.

## Rủi ro nhập liệu, không phải lỗi đã chứng minh

Mật khẩu `PVCFC@123` phân biệt hoa/thường. Nếu gõ thành `pvcfc@123` hoặc `Pvcfc@123` thì bcrypt sẽ từ chối. Đây là hành vi đúng của xác thực mật khẩu.

Bộ gõ tiếng Việt cũng có thể gây nhập sai trên một số thiết bị, nhưng không có bằng chứng từ code cho thấy backend/frontend tự biến đổi mật khẩu. Frontend gửi nguyên chuỗi password người dùng nhập.

## Kiểm tra DB local tại thời điểm phân tích

DB local `storage/okr_automation.db` có 62 users:

- 55 user khớp `PVCFC@123`.
- 7 user không khớp và thuộc nhóm demo/legacy: `admin`, `leader`, `fi`, `TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK`.

Với tiêu chí reset chọn lọc, các candidate non-admin cần reset trong DB local là:

- `leader`
- `fi`
- `TBHTĐK`
- `TBCH`
- `TBĐL`
- `TCĐK`

`admin` cũng có thể xuất hiện như candidate, nhưng không nên tự reset Admin trong deploy tự động.

## Hướng xử lý đã chọn

1. Sửa frontend và backend login để giảm lỗi user id bị viết hoa trên điện thoại.
2. Thêm script reset chọn lọc, mặc định dry-run, production deploy gọi với `--apply`.
3. Script chỉ reset user đủ điều kiện an toàn, set password về `PVCFC@123`, bật `must_change_password=True`, và ghi audit `safe_default_password_reset`.
4. Không tự reset Admin.
5. Không dùng `--reset-passwords` đại trà cho bài toán này vì có thể ảnh hưởng user đã đổi mật khẩu riêng.
