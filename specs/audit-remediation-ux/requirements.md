# Requirements — Khắc phục audit và cải thiện UI/UX KHMT / OKR / FI / ET

Ngày lập: 08/09/2026. Trạng thái: **spec sẵn sàng cho agent triển khai; chưa phải các bản sửa đã hoàn thành**.

## 1. Mục tiêu và cách đọc

Làm cho người dùng có thể nhập, tìm, xem và xử lý công việc mà không mất nội dung âm thầm, không hiểu sai số liệu và không gặp thao tác vượt quyền. Bảo vệ dữ liệu đã chốt và thay đổi quản trị qua các lần triển khai. Cải thiện toàn bộ trải nghiệm các phân hệ hiện có, ưu tiên luồng thường dùng trên điện thoại.

Bộ spec gồm đúng ba tài liệu: `requirements.md` mô tả kết quả cần đạt; [design.md](design.md) quyết định cách triển khai; [tasks.md](tasks.md) chia công việc, phụ thuộc và bằng chứng hoàn thành. Tên `tasks.md` theo cấu trúc spec của [Kiro](https://kiro.dev/docs/specs/quick-spec/). Acceptance criteria dùng mẫu EARS: **KHI / NẾU / TRONG KHI … HỆ THỐNG PHẢI …**. Mỗi tiêu chí có ID để liên kết với test.

Nguồn đầu vào: [báo cáo audit](../../../output/audit-2026-09-08/BAO_CAO_AUDIT.md), [ảnh UI](../../../output/audit-2026-09-08/index.html), [tái hiện frontend](../../../output/audit-2026-09-08/frontend-reproductions.json), [tái hiện backend](../../../output/audit-2026-09-08/backend-reproductions.json). Mốc tham chiếu là commit `c3cdcc90fbaf995fa13d5e116d46314206593cd9` cộng thay đổi local chưa commit. Agent phải đọc worktree hiện tại trước khi sửa; không reset các thay đổi có sẵn.

Audit đã xác nhận một số lỗi bằng giao diện production, một số bằng dữ liệu giả, số khác qua mã. **Không có kết luận rằng dữ liệu production đã mất.** Số 55 nhân sự, 175 FI và kích thước UI trong audit là mẫu quan sát, không phải hằng số nghiệp vụ. Bộ test cũ 224 backend / 58 frontend đạt tại thời điểm audit là baseline, không chứng minh các yêu cầu dưới đây đã đạt.

## 2. Phạm vi, ưu tiên và giới hạn

- **P1:** ngăn sai/mất dữ liệu, bảo vệ kỳ chốt, bỏ thao tác deploy ghi lại dữ liệu và khắc phục màn hình FI mobile bị che.
- **P2:** tính nhất quán quyền/số liệu, bản nháp FI, upload, concurrency, phiên đăng nhập, thông báo, lỗi mạng, accessibility và khả năng tìm kiếm.
- **P3:** củng cố vận hành, hiệu năng, phản hồi người dùng và các đường ít dùng. Rủi ro phát hiện thêm có thể nâng ưu tiên nếu có bằng chứng.
- Gồm sửa mã, migration tăng thêm, test tự động, QA dữ liệu giả, tài liệu vận hành và gói phát hành để chủ sản phẩm xem xét.
- Không tự thay định mức KHMT/FI, cách tính điểm năng lực, role nghiệp vụ, quyền lãnh đạo/đầu mối hoặc nội dung workbook lịch sử.
- Không thay framework, viết lại toàn bộ app, đổi nhận diện thương hiệu hay thêm animation trang trí để hoàn thành mục tiêu UX.
- Không tự mở rộng quyền Staff vào ET. Mặc định bảo toàn quyền backend hiện tại; trải nghiệm cá nhân ET là một tính năng khác nếu chủ sản phẩm yêu cầu sau.
- **Không có quyền triển khai hoặc thử ghi trên production từ bộ spec này.** Hạn chế này xuất phát từ chỉ dẫn trực tiếp của chủ sản phẩm trong yêu cầu audit. Việc đọc spec không phải sự cho phép deploy.

## 3. Vai trò và thuật ngữ

| Tên trong mã | Tên hiển thị | Nguyên tắc cần giữ |
|---|---|---|
| `Admin` | Quản trị | Nhập/sửa/chốt OKR; quản lý ET; UI mặc định chỉ xem, bật chỉnh sửa có chủ ý |
| `Workshop_Leader` | Lãnh đạo Xưởng | Xem/duyệt đúng workflow hiện tại; không suy ra được sửa mọi phân hệ |
| `FI_Coordinator` | Đầu mối FI | Xử lý FI theo trạng thái; không tự duyệt hồ sơ của mình hoặc gửi hộ theo kiểm soát hiện có |
| `Team_Account` | Tài khoản đội/tổ | OKR chỉ xem đội mình; ET assessment/plan hiện giới hạn Personnel liên kết user, không phải mặc nhiên mọi người trong đội |
| `Staff` | Nhân viên | OKR xem; FI theo quyền hiện có; không gọi các ET endpoint bị cấm |

`Kỳ` = đội + tháng + năm. `Bản nháp` và `bản đã gửi` của cùng kỳ có thể cùng hiện hành trong hai luồng khác nhau. `Revision` là mốc kiểm soát cạnh tranh của tài nguyên, khác số phiên bản báo cáo nghiệp vụ. `Đã lưu` chỉ có nghĩa server xác nhận nội dung đang hiển thị. `Bản khôi phục trên thiết bị` chưa phải bản lưu server. `Production` gồm API, database, storage và tài khoản thật; `môi trường thử` dùng database/storage mới và danh tính giả.

## 4. Requirements và acceptance criteria

### R01 — An toàn thực thi và dữ liệu thử [P1]

User story: Là chủ sản phẩm, tôi muốn agent sửa và kiểm thử mà không tác động dữ liệu vận hành.

- **R01.1** KHI agent bắt đầu, agent PHẢI ghi nhận commit, diff có sẵn, URL môi trường, database/storage thử và đọc các hướng dẫn repo đang áp dụng; không ghi secrets vào tài liệu.
- **R01.2** KHI chạy test có reset/seed/import/mutation, test harness PHẢI xác nhận database và cả sandbox storage nằm trong vùng thử mới, trước khi import module tạo engine hoặc chạy fixture.
- **R01.3** NẾU thiếu định danh môi trường thử hoặc đích trùng production/storage thật, harness PHẢI dừng trước mọi ghi; `environment=development` một mình không phải bằng chứng cô lập.
- **R01.4** KHI QA production trong phạm vi đã được cho phép, browser PHẢI chỉ dùng danh sách endpoint đọc đã kiểm tra side effect và đăng nhập; không coi mọi GET đều vô hại. Export có tạo file/audit log cũng không được tự động thử.
- **R01.5** TRONG KHI triển khai spec ở local, agent PHẢI giữ nguyên dữ liệu/code người dùng chưa thuộc thay đổi được thực hiện; không force reset, xóa storage, deploy, gửi email/Slack hoặc gọi LLM ngoài để test.
- **R01.6** KHI phát hiện dữ liệu cũ mâu thuẫn cần sửa, agent PHẢI xuất báo cáo chỉ đọc và phương án cụ thể; không tự chọn bản ghi thắng, backfill nghiệp vụ hoặc xóa bản cũ.

### R02 — Deploy và import lịch sử không thay dữ liệu đã quản lý [P1, D01]

User story: Là admin, tôi muốn deploy phần mềm mà báo cáo và phân bổ đã xác nhận giữ nguyên.

- **R02.1** KHI deploy thông thường hoặc restart, hệ thống PHẢI không chạy import lịch sử T5/T6 hay công việc tương đương thay dữ liệu nghiệp vụ.
- **R02.2** KHI chạy công cụ import riêng, công cụ PHẢI mặc định chỉ preview; ghi rõ kỳ, nguồn, hash file, số thêm/bỏ qua/xung đột và lý do.
- **R02.3** KHI apply import chế độ thêm mới, kỳ đã có draft, submitted hoặc locked PHẢI được bỏ qua/báo xung đột; không thay `is_current_version`, nội dung, status, ID hoặc FI allocation.
- **R02.4** NẾU chủ sản phẩm yêu cầu thay một kỳ chưa chốt, công cụ PHẢI dùng preview ràng buộc revision/hash hiện tại, phạm vi chính xác, lý do và lịch sử trước/sau; kỳ đã chốt luôn phải đi qua mở chốt có thẩm quyền.
- **R02.5** KHI import/deploy được chạy lặp hoặc lỗi giữa chừng, hệ thống PHẢI không có hai bản hiện hành cùng luồng; kết quả áp dụng phải nguyên tử theo kỳ và có tóm tắt kỳ thành công/thất bại rõ ràng.
- **R02.6** KHI migration kiểm tra dữ liệu trước nâng cấp, mọi bản cũ và file gốc PHẢI còn truy xuất được; không tự sửa lịch sử để làm test qua.

### R03 — Seed chỉ khởi tạo, bảo toàn quản trị [P1, D02]

User story: Là admin, tôi muốn trạng thái tài khoản, đội, chức danh và bậc nhân sự đã sửa không bị hoàn tác.

- **R03.1** KHI deploy thông thường, hệ thống PHẢI không seed lại người dùng, nhân sự hoặc framework ET đang được quản lý.
- **R03.2** KHI chạy seed khởi tạo có chủ ý, bản ghi đã tồn tại PHẢI được giữ nguyên password hash, active, role, team, tên, liên kết user/personnel, cờ ẩn, chức danh, bậc lương, bậc năng lực và dữ liệu framework đã chỉnh.
- **R03.3** NẾU tài khoản bị vô hiệu hóa hoặc nhân sự inactive, seed PHẢI không kích hoạt lại.
- **R03.4** KHI cần đồng bộ một trường từ nguồn mới, PHẢI có migration/import riêng với danh sách trường, preview và audit; không dùng cờ overwrite toàn bộ mặc định.
- **R03.5** KHI bootstrap database rỗng, hệ thống PHẢI tạo đủ dữ liệu tối thiểu bằng danh tính thử hoặc cấu hình an toàn; không lưu mật khẩu production vào repo, test hay log.
- **R03.6** KHI seed chạy lần hai, số bản ghi nghiệp vụ và các trường người dùng quản lý PHẢI không thay đổi.

### R04 — Editor tự lưu trung thực, khôi phục và điều hướng an toàn [P1, D03]

User story: Là người nhập OKR/ET, tôi muốn phần vừa gõ luôn được giữ và biết chính xác phần nào đã lên server.

- **R04.1** KHI người dùng sửa nội dung, editor PHẢI tăng revision local và chuyển sang “Chưa lưu”; không chờ request mới đánh dấu dirty.
- **R04.2** KHI request lưu A đang chạy và người dùng gõ B, phản hồi A PHẢI không thay B, không báo B đã lưu; sau A phải tiếp tục lưu B nếu còn quyền và không có xung đột.
- **R04.3** KHI không có request đang chạy và người dùng dừng gõ 1 giây, editor PHẢI bắt đầu autosave; nút “Lưu ngay” phải flush hàng đợi. Không có hai mutation đồng thời cho cùng editor.
- **R04.4** NẾU server trả conflict, editor PHẢI giữ nguyên nội dung local, dừng autosave, hiển thị bản server để so sánh và yêu cầu lựa chọn rõ ràng; không tự `load()` đè bản soạn hoặc ẩn lỗi.
- **R04.5** KHI rời phân hệ, tab con, đổi đội/kỳ/phiếu, Back/Forward hoặc đăng xuất trong lúc dirty/in-flight, UI PHẢI bảo vệ bằng cùng một navigation guard. Lựa chọn bỏ nội dung phải nói rõ phạm vi bỏ; lưu thất bại phải giữ người dùng ở editor.
- **R04.6** KHI đóng/reload trang có thay đổi chưa được server xác nhận, hệ thống PHẢI dùng cảnh báo trình duyệt khi được hỗ trợ và giữ bản khôi phục cùng tài khoản/ngữ cảnh trong storage của phiên tab. Không cam kết chống mọi trường hợp mất điện hoặc browser cưỡng bức đóng.
- **R04.7** NẾU storage không ghi được, UI PHẢI thông báo khả năng khôi phục bị hạn chế và có thao tác tải bản nháp; không hiển thị “Đã lưu trên thiết bị” sai.
- **R04.8** KHI request đọc kỳ A về sau request kỳ B, chỉ phản hồi khớp context/request hiện tại PHẢI được áp dụng; dữ liệu A không được xuất hiện dưới nhãn kỳ B.
- **R04.9** KHI khôi phục sau reload hoặc đăng nhập lại, hệ thống PHẢI xác minh cùng user/namespace, so sánh revision server và cho người dùng xem bản khôi phục trước khi tiếp tục; không tự gửi lại.

### R05 — Kiểm soát phiên bản nguyên tử ở backend [P1, D03]

User story: Là admin làm việc ở nhiều tab, tôi muốn bản cũ không thể ghi đè bản mới.

- **R05.1** KHI đọc editor OKR hoặc ET, API PHẢI trả revision kiểm soát cạnh tranh cùng ID/ngữ cảnh của dữ liệu.
- **R05.2** KHI save/submit/lock hoặc mutation làm thay nội dung editor, API PHẢI yêu cầu revision dự kiến, kiểm tra và cập nhật trong một transaction có khóa/CAS thực sự.
- **R05.3** NẾU revision đã thay đổi, API PHẢI trả `409 VERSION_CONFLICT` cùng metadata mới và không sửa bất cứ nội dung, cờ hiện hành, file chuẩn hay audit thành công nào.
- **R05.4** NẾU client cũ thiếu revision sau khi bật chế độ bắt buộc, API PHẢI từ chối với lỗi cần cập nhật client; không âm thầm bỏ qua bảo vệ.
- **R05.5** KHI hai người tạo draft đầu tiên hoặc gửi cùng lúc, database PHẢI có tối đa một draft hiện hành và một published hiện hành trong phạm vi định nghĩa; draft và published khác luồng vẫn được cùng tồn tại hợp lệ.
- **R05.6** KHI submit, API PHẢI xác nhận đúng bản người dùng đã xem/lưu; một draft mới hơn không được bỏ cờ hiện hành bởi submit bản cũ.
- **R05.7** KHI ET cập nhật điểm, ghi chú, refresh-required-scores hoặc submit, revision PHẢI bao phủ cả dữ liệu con và trạng thái; sửa ở phiên khác không được mất âm thầm.

### R06 — Bất biến kỳ đã chốt và tính toàn vẹn FI [P1, D04]

User story: Là người chốt KHMT, tôi muốn số liệu đã chốt không đổi qua một đường API khác.

- **R06.1** KHI FI chuyển/bỏ kỳ, đổi đội, đổi trạng thái hoặc thay trường ảnh hưởng kết quả chốt, mọi kỳ nguồn/đích có liên quan PHẢI được kiểm tra khóa trong cùng transaction.
- **R06.2** NẾU một kỳ liên quan đang chốt, mutation PHẢI trả `409 PERIOD_LOCKED` và không thay FI, report, allocation, lịch sử hay cache như thể đã thành công; áp dụng cả Admin.
- **R06.3** KHI cần điều chỉnh kỳ chốt, Admin PHẢI mở chốt qua workflow có lý do, điều chỉnh, preview lại rồi chốt; không có cờ bypass trong API thông thường.
- **R06.4** KHI chốt và phân bổ thủ công diễn ra đồng thời, kết quả PHẢI tương đương một thứ tự thực thi hợp lệ; không có FI nằm ngoài snapshot sau khi chốt thành công.
- **R06.5** KHI preview chốt đã cũ do báo cáo hoặc nguồn FI đổi, chốt PHẢI báo cần preview lại, không tự chọn danh sách khác mà vẫn hiển thị preview cũ.
- **R06.6** KHI chốt, định mức theo assessment, chiến lược chọn FI, trường hợp thiếu nguồn và lịch sử phân bổ hiện có PHẢI được giữ nguyên, trừ thay đổi được chủ sản phẩm yêu cầu riêng.
- **R06.7** KHI migration gặp nhiều report locked/current mâu thuẫn hoặc allocation trỏ sai phiên bản, PHẢI báo cáo và dừng phạm vi bị ảnh hưởng; không tự gỡ chốt, chuyển FI hay xóa lịch sử.

### R07 — Tạo FI đồng thời và gửi lại không trùng [P2, D05/U06]

User story: Là nhân viên, tôi muốn đăng ký thành công dù nhiều người cùng gửi hoặc mạng bị gián đoạn.

- **R07.1** KHI hai request tạo FI cùng đội/tháng chạy đồng thời, mỗi hồ sơ khác nhau PHẢI có mã duy nhất đúng format hiện tại; không lộ lỗi constraint/500 vì tranh sequence.
- **R07.2** KHI sequence của kỳ chưa tồn tại, việc khởi tạo và cấp số PHẢI vẫn nguyên tử; không chỉ bảo vệ lần tăng tiếp theo.
- **R07.3** KHI cùng user gửi lại cùng operation key và payload, API PHẢI trả lại đúng hồ sơ đã tạo, không tạo thêm hồ sơ, thông báo hay event nghiệp vụ.
- **R07.4** NẾU key cũ được dùng với payload khác, API PHẢI trả `409 IDEMPOTENCY_CONFLICT`; không lấy payload mới thay hồ sơ cũ.
- **R07.5** KHI server commit nhưng response bị mất, UI PHẢI đối soát/retry cùng key; không tạo key mới chỉ vì timeout, refresh hoặc bấm hai lần.
- **R07.6** KHI một transaction thất bại, sequence/idempotency/FI PHẢI có trạng thái nhất quán; không cam kết số thứ tự không có khoảng trống, không đánh lại mã hồ sơ cũ.

### R08 — Bản nháp đăng ký FI và biểu mẫu dài [P2, U05]

User story: Là nhân viên đang mô tả sáng kiến, tôi muốn quay lại nội dung nếu đổi màn hình hoặc hết phiên.

- **R08.1** KHI form đăng ký FI thay đổi, phần text/giá trị lựa chọn PHẢI có bản khôi phục theo user/namespace/draft ID và navigation guard như R04.
- **R08.2** KHI quay lại, UI PHẢI cho khôi phục hoặc chủ ý bỏ bản nháp, giữ đúng tác giả/người gửi hộ và đội đã chọn, rồi kiểm tra lại quyền hiện tại.
- **R08.3** NẾU file ảnh không thể khôi phục sau reload, UI PHẢI giữ danh sách tên/trạng thái cần chọn lại; không giả vờ ảnh vẫn sẵn sàng upload.
- **R08.4** KHI validate lỗi, UI PHẢI chỉ rõ trường, giữ toàn bộ nội dung, đưa focus tới tóm tắt lỗi/trường đầu tiên và cho sửa tại chỗ.
- **R08.5** KHI hồ sơ đã được tạo, UI PHẢI lưu record ID và operation key trước khi chuyển bước ảnh; không khôi phục thành một form tạo mới không biết record cũ.
- **R08.6** KHI bắt đầu hồ sơ mới hoặc bỏ bản nháp, thao tác PHẢI có chủ ý; chỉ dọn bản nháp tương ứng, không xóa bản khác hoặc dữ liệu server.

### R09 — Upload ảnh phục hồi được, không tạo FI lần hai [P2, U06]

User story: Là người đăng ký FI, tôi muốn biết hồ sơ đã tạo và chỉ thử lại ảnh bị lỗi.

- **R09.1** KHI tạo FI thành công, UI PHẢI chuyển sang ngữ cảnh hồ sơ đã có mã trước khi upload ảnh; lỗi ảnh không biến bước tạo thành thất bại.
- **R09.2** NẾU một trong nhiều ảnh lỗi, ảnh thành công PHẢI được giữ; UI liệt kê từng ảnh thành công/lỗi/đang chờ và có “Thử lại ảnh lỗi”.
- **R09.3** KHI retry upload cùng ảnh cùng record/operation, server PHẢI không tạo bản ảnh trùng do response mất.
- **R09.4** KHI file sai định dạng, vượt giới hạn hoặc nội dung không khớp MIME, UI/API PHẢI báo lỗi rõ và không để file hỏng có thể được tải như ảnh hợp lệ.
- **R09.5** KHI reload ở bước ảnh, UI PHẢI tra record ID cũ, tải danh sách ảnh đã nhận và yêu cầu chọn lại các file còn thiếu; không POST tạo FI mới.
- **R09.6** KHI người dùng rời bước ảnh, UI PHẢI cho biết FI đã tồn tại và số ảnh chưa gửi; không xóa FI để bù lỗi upload.

### R10 — Lịch sử FI mobile và tìm kiếm hiệu quả [P1 cho che nội dung; P2 cho mở rộng, U01]

User story: Là người dùng điện thoại, tôi muốn tìm và mở FI nhanh mà không bị bộ lọc che màn hình.

- **R10.1** KHI viewport rộng 320–430 px, trang PHẢI không cuộn ngang toàn trang; thẻ thống kê và bộ lọc mở rộng không được nằm trong vùng sticky dài.
- **R10.2** TRONG KHI cuộn, tổng phần ghim trên PHẢI không quá `min(128px, 25% chiều cao viewport)` và điều hướng dưới không quá 72 px ở mức zoom chuẩn; nếu không đủ chỗ phải bỏ ghim.
- **R10.3** KHI bàn phím mở, landscape hoặc phóng to chữ, UI PHẢI để input/focus/nút chính nhìn thấy được bằng cuộn; không dùng chiều cao cứng che nội dung.
- **R10.4** KHI có kết quả trên mobile, kết quả đầu tiên PHẢI xuất hiện trong vùng màn hình ban đầu dưới toolbar với bộ lọc mở rộng đóng; thống kê mặc định gọn.
- **R10.5** KHI tìm kiếm/lọc, API và UI PHẢI áp dụng cùng điều kiện cho danh sách, tổng số và export; query trên toàn dữ liệu có quyền, không chỉ trang đã tải.
- **R10.6** KHI dữ liệu lớn, UI PHẢI tải tối đa 25 hồ sơ một trang mặc định, cho chọn 50; giới hạn API tối đa 100, giữ sort ổn định và điều hướng trang rõ ràng.
- **R10.7** KHI mở chi tiết rồi quay lại, UI PHẢI giữ bộ lọc, từ khóa, trang và vị trí cuộn nếu dữ liệu không thay; khi có thay đổi phải thông báo và phục hồi hợp lý.
- **R10.8** KHI không có kết quả, UI PHẢI phân biệt “Chưa có FI” với “Không có kết quả phù hợp”, hiển thị số bộ lọc đang áp dụng và thao tác xóa lọc.

### R11 — Menu, thao tác và quyền nhất quán [P2, U02/U07]

User story: Là người dùng, tôi chỉ muốn thấy luồng mình sử dụng được và hiểu lý do một thao tác chưa khả dụng.

- **R11.1** KHI user là Staff, UI PHẢI không hiện ET như phân hệ dùng được hoặc gọi năm endpoint ET hiện bị cấm; deep link phải hiện trạng thái không có quyền và đường quay lại.
- **R11.2** KHI user có quyền một phần ET, UI PHẢI chỉ gọi các endpoint phụ trợ có quyền; FI_Coordinator xem summary không đồng nghĩa được gọi heatmap hoặc personnel.
- **R11.3** KHI tạo menu/nút, frontend PHẢI dựa trên capability từ phiên đã xác thực; backend vẫn kiểm tra role, ownership, team và trạng thái trên từng request.
- **R11.4** NẾU thao tác không thuộc quyền user, PHẢI ẩn; NẾU thuộc quyền nhưng bị chặn bởi trạng thái, PHẢI giải thích lý do bằng chữ, không chỉ nút disabled không có mô tả.
- **R11.5** KHI ở production hoặc token không phải sandbox hợp lệ, UI PHẢI không hiển thị “Reset dữ liệu”; API sandbox vẫn phải từ chối ở production.
- **R11.6** KHI Admin đăng nhập/reload, chế độ chỉnh sửa PHẢI mặc định tắt và có dấu hiệu rõ khi bật; bật chế độ không bỏ qua khóa kỳ hay version.
- **R11.7** KHI quyền thay đổi giữa phiên, UI PHẢI xử lý 403 mà giữ nội dung soạn, cập nhật capability và không tự gửi lại với quyền mới.

### R12 — Số liệu STOP và cách diễn đạt đúng [P2, U03]

User story: Là người xem dashboard, tôi muốn nhãn phần trăm phản ánh đúng dữ liệu và hiểu tử/mẫu.

- **R12.1** KHI tỷ lệ vượt 140%, nhãn PHẢI hiển thị tỷ lệ thật làm tròn thống nhất; chỉ độ dài thanh được giới hạn.
- **R12.2** KHI dữ liệu là 15/7, 11/6, 12/8, 6/5 hoặc 44/26, UI PHẢI hiển thị lần lượt 214%, 183%, 150%, 120%, 169%.
- **R12.3** NẾU mẫu số bằng 0 hoặc thiếu, UI PHẢI hiển thị “Chưa đủ dữ liệu”/“—” cùng lý do; không Infinity/NaN và không biến thiếu dữ liệu thành đạt chỉ tiêu.
- **R12.4** KHI metric là số thẻ chia số người, nhãn/tooltip PHẢI nêu đúng “Số thẻ / số nhân sự”; không gọi đó là tỷ lệ người tham gia duy nhất.
- **R12.5** KHI hiển thị tổng, tổng PHẢI theo tổng tử/tổng mẫu, không lấy trung bình đơn giản các phần trăm đội; không sửa công thức chấm điểm nghiệp vụ ngoài lỗi hiển thị.

### R13 — ET giải thích tình trạng hồ sơ và bước tiếp theo [P2, U04]

User story: Là admin, tôi muốn biết tại sao có tài khoản/nhân sự nhưng chưa xuất hiện trong dashboard năng lực.

- **R13.1** KHI ET trả số nhân sự, response/UI PHẢI phân biệt tài khoản liên kết, hồ sơ Personnel, hồ sơ thỏa điều kiện dashboard hiện tại và hồ sơ có thể tạo đánh giá.
- **R13.2** KHI có hồ sơ chưa đủ điều kiện, UI PHẢI hiển thị số thiếu vị trí, thiếu bậc, thiếu liên kết hoặc thiếu khung áp dụng cùng định nghĩa; không tự điền bậc/khung để làm số tổng tăng.
- **R13.3** KHI các lý do có thể trùng, UI PHẢI nói rõ số đếm có thể chồng lấp hoặc cung cấp nhóm loại trừ nhau; không cộng thành tổng sai.
- **R13.4** NẾU dashboard không có người đủ điều kiện, UI PHẢI hiển thị hướng dẫn hoàn thiện hồ sơ; không render heatmap dài chỉ có hàng tiêu chí.
- **R13.5** KHI user có quyền sửa nhân sự, CTA PHẢI mở đúng danh sách/điều kiện cần hoàn thiện; người chỉ xem nhận hướng dẫn liên hệ admin, không thấy nút ghi vượt quyền.
- **R13.6** KHI bộ lọc đội/vị trí/bậc đổi, thống kê và danh sách PHẢI dùng cùng population đã định nghĩa và không lộ số người ngoài phạm vi quyền.

### R14 — Lỗi API, hết phiên và trạng thái tải nhất quán [P2]

User story: Là người dùng, tôi muốn biết đang chờ, thiếu dữ liệu hay gặp lỗi và có cách tiếp tục.

- **R14.1** KHI API lỗi, client PHẢI giữ HTTP status, error code, thông báo tiếng Việt, lỗi từng trường và request ID; không biến tất cả thành `Error(string)` mất metadata.
- **R14.2** NẾU 401, ứng dụng PHẢI mở luồng đăng nhập lại một lần, dừng mutation mới và giữ nháp; sau đăng nhập cùng user phải kiểm tra phiên bản trước khi người dùng chủ ý tiếp tục.
- **R14.3** NẾU 403, 409, 422, 429, offline hoặc 5xx, UI PHẢI hiển thị hành động phù hợp; không trình bày lỗi quyền như danh sách rỗng và không lộ JSON/HTML thô.
- **R14.4** KHI GET được retry do lỗi tạm thời, hệ thống PHẢI giới hạn số lần/backoff; mutation không có idempotency không được retry tự động sau timeout không rõ kết quả.
- **R14.5** KHI đổi màn hình/bộ lọc hoặc unmount, request đọc cũ PHẢI bị hủy/bỏ kết quả; request ghi đã gửi không được giả định server đã hủy chỉ vì AbortController.
- **R14.6** TRONG KHI tải, UI PHẢI giữ bố cục, thể hiện busy và cho biết dữ liệu cũ nếu vẫn hiển thị; không nhấp nháy “0” như một kết quả thật.

### R15 — Thu hồi phiên sau đổi mật khẩu [P2, S01]

User story: Là người dùng/admin, tôi muốn token cũ ngừng hoạt động sau đổi hoặc reset mật khẩu.

- **R15.1** KHI đổi/reset mật khẩu thành công, server PHẢI tăng session version trong cùng transaction với password hash; mọi token cũ bị từ chối.
- **R15.2** KHI cấp token mới, version PHẢI lấy từ database hiện tại, không lấy từ client; kiểm tra active/role/team hiện tại tiếp tục được giữ.
- **R15.3** KHI admin reset mật khẩu, token trước reset PHẢI vẫn vô hiệu sau khi người dùng hoàn thành đổi mật khẩu bắt buộc.
- **R15.4** KHI người dùng chọn “Đăng xuất tất cả thiết bị”, token hiện có PHẢI bị thu hồi và UI đi qua bảo vệ bản nháp; không âm thầm cung cấp hành vi này cho đăng xuất một tab thông thường.
- **R15.5** KHI phát hành cơ chế mới, token không có version PHẢI theo chính sách cutover rõ ràng ở design; không được chấp nhận vô thời hạn như version mới.
- **R15.6** KHI kiểm thử cơ chế phiên, chỉ tài khoản giả PHẢI được dùng; không đổi/reset mật khẩu được chủ sản phẩm cung cấp.

### R16 — Thông báo đúng người nhận, trạng thái đọc riêng [P2, S02]

User story: Là người nhận thông báo, tôi muốn người khác đọc không làm mất dấu công việc của mình.

- **R16.1** KHI list/read/mark-read thông báo, cùng một predicate đối tượng nhận PHẢI được dùng; không truy cập được chỉ vì recipient_role hoặc recipient_user_id là null.
- **R16.2** KHI user không thuộc đối tượng nhận, API PHẢI từ chối mà không thay receipt/audit thành công; biết ID không tạo ra quyền.
- **R16.3** KHI một người đọc thông báo role/broadcast, trạng thái đọc của người khác PHẢI không đổi.
- **R16.4** KHI mark-read được retry, kết quả PHẢI idempotent và không tạo receipt trùng.
- **R16.5** KHI migrate cờ read chung cũ, hệ thống PHẢI không bịa ai đã đọc; dữ liệu không thể suy ra phải được đánh dấu lịch sử không xác định theo chính sách design.
- **R16.6** KHI UI mở panel thông báo, chỉ hành động đọc được định nghĩa rõ PHẢI đánh dấu; unread count phải tính theo user, không theo tổng cờ read chung.

### R17 — Import/export đúng phạm vi, file và database nhất quán [P2]

User story: Là admin, tôi muốn file tải xuống đúng kỳ và việc thay dữ liệu có preview rõ ràng.

- **R17.1** KHI export dashboard hoặc danh sách, request PHẢI chỉ rõ kỳ/bộ lọc và response PHẢI chứa đúng tập dữ liệu có quyền; không mặc định lấy mọi current report.
- **R17.2** KHI endpoint cũ chưa có UI hoặc caller chưa rõ, agent PHẢI kiểm kê caller trước khi đổi hợp đồng; không tạo thêm nút upload nguy hiểm chỉ để dùng hết API.
- **R17.3** NẾU upload Excel trùng kỳ, UI/API PHẢI giải thích thêm mới/bỏ qua/thay thế; apply thay thế phải ràng buộc preview, quyền, revision và kỳ chưa chốt.
- **R17.4** KHI tạo file, đường dẫn nội bộ PHẢI duy nhất theo artifact/request/version; tên tải xuống thân thiện không được dùng làm tên file dùng chung.
- **R17.5** NẾU tạo file lỗi sau lưu nội dung, server/UI PHẢI phân biệt nội dung đã lưu với file chưa tạo; không rollback giả, không yêu cầu người dùng tạo lại hồ sơ.
- **R17.6** KHI tải file, PHẢI kiểm tra quyền ở endpoint, không lộ đường dẫn máy chủ; file tạm mồ côi được dọn có tuổi/nguồn gốc xác định và không xóa file đã tham chiếu.
- **R17.7** KHI migration hoặc thay đổi cách tạo Excel, các giá trị, sheet/formula thuộc nghiệp vụ PHẢI được so với fixture mẫu có ý nghĩa; không dùng việc file mở được làm bằng chứng số liệu đúng.

### R18 — Sao lưu, phục hồi và phát hành có thể kiểm chứng [P2]

User story: Là chủ sản phẩm, tôi muốn biết có thể phục hồi database cùng file nếu xảy ra sự cố.

- **R18.1** KHI chuẩn bị release, PHẢI có inventory backup hiện tại, timestamp, kích thước, checksum, nơi lưu và trạng thái lần kiểm tra; thiếu bằng chứng phải ghi là chưa xác minh.
- **R18.2** KHI thiết kế backup, PHẢI gồm database, file tham chiếu và manifest phiên bản ứng dụng/schema; ít nhất một bản ngoài VPS trong hạ tầng được chủ sản phẩm chọn, có kiểm soát truy cập và retention.
- **R18.3** KHI diễn tập restore, chỉ đích cô lập PHẢI được dùng; so số lượng, checksum nội dung, liên kết file/report/FI và khả năng đăng nhập bằng tài khoản thử.
- **R18.4** KHI đặt mục tiêu vận hành, mặc định đề xuất RPO 24 giờ / RTO 4 giờ PHẢI được ghi là mục tiêu chờ xác nhận, không phải năng lực đã đạt; không báo hoàn thành chỉ vì có script backup.
- **R18.5** KHI rollback ứng dụng, PHẢI ưu tiên phiên bản tương thích schema tăng thêm; không restore database đè các giao dịch mới như bước rollback mặc định.
- **R18.6** KHI cần thao tác production thật, PHẢI bàn giao lệnh/phạm vi/ảnh hưởng đã review cho chủ sản phẩm; chỉ thực thi khi có ủy quyền mới, không suy ra từ yêu cầu viết spec.

### R19 — Đăng nhập chống lạm dụng và không gây khó dùng [P2]

User story: Là admin, tôi muốn hạn chế thử mật khẩu nhưng người dùng nội bộ vẫn đăng nhập bình thường.

- **R19.1** KHI có nhiều lần đăng nhập thất bại, server PHẢI áp dụng limiter theo IP và cặp IP+tài khoản chuẩn hóa; không chỉ khóa tài khoản toàn cục dễ gây từ chối dịch vụ.
- **R19.2** KHI bị giới hạn, API PHẢI trả 429 với thời gian chờ; UI hiện thông báo dễ hiểu, không lộ việc tài khoản có tồn tại hay không.
- **R19.3** KHI chạy nhiều worker, bộ đếm PHẢI dùng kho chia sẻ hoặc lớp hạ tầng đã xác minh; không giả định dict trong một process đủ bảo vệ.
- **R19.4** NẾU kho limiter lỗi, hành vi suy giảm PHẢI có giới hạn và cảnh báo vận hành theo design, không khóa toàn bộ người dùng vô thời hạn.
- **R19.5** KHI test limiter, chỉ fake clock/danh tính giả/môi trường thử PHẢI được dùng; không brute-force production.

### R20 — Phiên LLM có chủ sở hữu và ranh giới dữ liệu [P2, có điều kiện kích hoạt]

User story: Là người dùng tính năng AI, tôi muốn lịch sử hội thoại không bị đọc hoặc xóa bởi người khác.

- **R20.1** KHI tạo phiên LLM, server PHẢI gắn owner user và namespace môi trường; client không được chiếm session ID của người khác.
- **R20.2** KHI đọc/gửi/xóa phiên, server PHẢI kiểm tra owner trên mọi nhánh; cả Admin cũng không tự có quyền đọc chat người khác nếu chưa có chính sách riêng.
- **R20.3** KHI tool LLM đọc dữ liệu nghiệp vụ, tool PHẢI nhận principal và áp dụng cùng scope với API; prompt không phải cơ chế phân quyền.
- **R20.4** KHI phiên hết TTL hoặc process restart, UI PHẢI giải thích lịch sử không còn khả dụng; không ghép vào phiên của user khác.
- **R20.5** KHI tính năng bị tắt, UI PHẢI ẩn/giải thích và API không khởi tạo kết nối ngoài. Kiểm thử bật dùng provider giả, không gửi dữ liệu thật ra dịch vụ ngoài.

### R21 — Ngôn ngữ, bố cục, accessibility và luồng công việc [P2]

User story: Là người dùng nội bộ trên nhiều thiết bị, tôi muốn giao diện nhất quán, dễ đọc và thao tác bằng chuột, chạm hoặc bàn phím.

- **R21.1** KHI hiển thị trang, UI PHẢI có tiêu đề, ngữ cảnh đội/kỳ, trạng thái và một hành động chính rõ; nhãn “FI (SK-CTKT)”, “Đã chốt”, “Bản nháp” thống nhất theo glossary.
- **R21.2** KHI dùng bàn phím, mọi nút, menu, tab, dialog và filter PHẢI thao tác được, focus nhìn thấy, thứ tự hợp lý; đóng dialog trả focus về nơi mở.
- **R21.3** KHI kiểm tra reflow ở 320 CSS px và zoom/text zoom, UI PHẢI không mất nội dung hoặc thao tác. Bảng/biểu đồ hai chiều có thể cuộn trong vùng riêng có tên truy cập.
- **R21.4** KHI hiển thị text/control, PHẢI đạt tương phản mục tiêu WCAG 2.2 AA, không dùng màu làm tín hiệu duy nhất; vùng chạm chính mục tiêu ít nhất 44×44 CSS px của sản phẩm.
- **R21.5** KHI mở modal/drawer/bottom sheet, UI PHẢI có tên truy cập, focus trap, Escape, khóa nền và vị trí phù hợp bàn phím ảo; không có modal chồng không thoát được.
- **R21.6** KHI thao tác thành công hoặc lỗi, UI PHẢI có phản hồi tại chỗ và thông báo screen reader phù hợp; lỗi quan trọng không tự biến mất chỉ theo timeout.
- **R21.7** KHI nội dung dài, UI PHẢI có nhóm trường, mục lục/điểm neo hoặc mở rộng hợp lý, giữ trạng thái đã nhập; không giấu thông tin bắt buộc sau tooltip chỉ hover.
- **R21.8** KHI user bật reduced motion, UI PHẢI bỏ chuyển động không cần thiết; animation không được cản đọc, nhập hoặc làm thay thứ tự focus.
- **R21.9** KHI xem Admin/OKR/FI/ET, PHẢI áp dụng các mẫu loading/empty/error/read-only/locked/success nhất quán nêu trong design; không chỉ sửa riêng một screenshot mobile.

Mục tiêu accessibility tham chiếu [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Kích thước 44 px ở trên là tiêu chuẩn trải nghiệm do spec lựa chọn; không mô tả sai đó là mức tối thiểu AA bắt buộc cho mọi control. Bộ kiểm tra này không tự cấp chứng nhận WCAG toàn sản phẩm.

### R22 — Hiệu năng và dependency có bằng chứng [P2/P3]

User story: Là người dùng mạng chậm, tôi muốn mở phân hệ và tìm dữ liệu mà không phải chờ tải toàn bộ ứng dụng/danh sách.

- **R22.1** KHI build, các phân hệ lớn PHẢI được tải theo nhu cầu; không tải ET/Admin/chart/export nặng vào luồng Staff FI nếu chưa sử dụng.
- **R22.2** KHI danh sách có 5.000 FI giả, API PHẢI lọc/phân trang ở server trước serialize; summary phải theo tập đã lọc, không tải mọi row để đếm trên client.
- **R22.3** KHI đo performance, agent PHẢI ghi máy/chế độ mạng/browser/dataset và baseline trước-sau; mục tiêu lab và tiêu chí so sánh dùng ở design, không trình bày thành số đo production.
- **R22.4** KHI cập nhật browserslist/nanoid/postcss hoặc dependency khác, PHẢI xác minh advisory hiện hành, đường sử dụng build/runtime và chạy kiểm tra liên quan; không dùng `audit fix --force` mặc định.
- **R22.5** KHI cache trả dữ liệu theo quyền/bộ lọc, key PHẢI bao gồm namespace và scope cần thiết; sau mutation thành công phải invalidation đúng, không xóa cache như thể thành công khi DB rollback.

### R23 — Phản hồi người dùng và quan sát lỗi [P3]

User story: Là chủ sản phẩm, tôi muốn nhận biết lỗi âm thầm mà không phải chờ người dùng tự giải thích toàn bộ vấn đề.

- **R23.1** KHI user chọn “Báo vấn đề”, UI PHẢI mở form ngắn có phân hệ/trang, loại vấn đề và mô tả; chỉ gửi khi user bấm gửi.
- **R23.2** KHI gửi feedback, hệ thống PHẢI lưu vào hạ tầng nội bộ đã cấu hình và báo đã nhận/khi lỗi; không tự gửi email, Slack hoặc hệ thống bên ngoài.
- **R23.3** KHI ghi telemetry, PHẢI dùng allowlist như event, duration, status/error code, route mẫu, build ID và request ID; không ghi password/token/nội dung editor/ảnh/chat hay query chứa tên người.
- **R23.4** KHI lỗi autosave, 409, 403 bất thường, 5xx hoặc upload lỗi xảy ra, metric PHẢI giúp đếm và đối chiếu luồng; lỗi telemetry không được chặn thao tác nghiệp vụ.
- **R23.5** KHI đánh giá UX trước phát hành, PHẢI có kịch bản cho 3–5 người đại diện hoặc ghi rõ chưa có người tham gia; không bịa feedback. Có thể hoàn thành phần triển khai bằng walkthrough dữ liệu giả, nhưng chưa được gọi đó là user validation.

### R24 — Kiểm thử, migration và bàn giao có truy vết [P1/P2]

User story: Là chủ sản phẩm giao việc cho AI Agent, tôi muốn biết từng lỗi đã được sửa bằng bằng chứng nào.

- **R24.1** KHI hoàn thành một task, agent PHẢI liên kết requirement/AC, mã thay đổi, test case và kết quả hiện hành; chỉ tick khi bằng chứng đạt, không tick theo ý định.
- **R24.2** KHI sửa lỗi dữ liệu/concurrency/quyền, PHẢI có regression chứng minh lỗi trước và hành vi đúng sau; cạnh tranh row lock phải test PostgreSQL thực trong môi trường cô lập.
- **R24.3** KHI sửa UI/UX, PHẢI có ảnh trước/sau cùng viewport/dataset và kiểm tra tương tác; screenshot đẹp đơn lẻ không chứng minh autosave, quyền hoặc bàn phím đúng.
- **R24.4** KHI migration tăng bảng/cột/constraint, PHẢI thử từ database có dữ liệu legacy giả, kiểm tra số lượng/hash/quan hệ và rollback ứng dụng tương thích; không chỉ thử database rỗng.
- **R24.5** KHI hoàn thành gói local, PHẢI chạy test hiện có cùng regression mới, build, migration rehearsal và các gate liên quan; lỗi có sẵn phải phân biệt nhưng không bị che bằng xóa test.
- **R24.6** KHI bàn giao, PHẢI có changelog, known limitations, ma trận role/state/device, ảnh, API/schema contract, migration/backup/rollback runbook và trạng thái gate production riêng.
- **R24.7** NẾU thiếu quyền production, thiết bị thật hoặc người tham gia, agent PHẢI ghi đúng gate còn chờ; vẫn hoàn thành công việc local độc lập, không tự thu hẹp yêu cầu hoặc tuyên bố production đã đạt.

## 5. Định nghĩa hoàn thành và các quyết định đã chốt trong spec

Hoàn thành **việc viết spec** khi ba file nhất quán, bao phủ đủ 14 finding và rủi ro bổ sung, task có dependency/AC/test/gate, không chứa credentials. Hoàn thành **triển khai local** là trạng thái khác, được định nghĩa trong `tasks.md`. Hoàn thành **phát hành production** đòi hỏi ủy quyền và bằng chứng môi trường thật; không phải yêu cầu thực thi của lượt viết spec này.

Mặc định triển khai đã chọn để agent không phải dừng hỏi những chi tiết thường lệ: giữ thương hiệu/nav hiện tại; Staff chưa có ET; draft recovery dùng storage phiên tab theo tài khoản; autosave debounce 1 giây; FI page size 25; backend giữ quyền là nguồn sự thật; tất cả sửa/test dùng dữ liệu giả. Các quyết định cần chủ sản phẩm cho vận hành thật gồm nơi backup ngoài VPS, RPO/RTO, thời gian cutover phiên đăng nhập và lịch phát hành. Agent phải chuẩn bị kết quả review được trước khi xin quyết định đó.
