from __future__ import annotations

from copy import deepcopy
from typing import Any


EVALUATION_CRITERIA: dict[str, Any] = {
    "sheet": "TCĐG",
    "title": "TIÊU CHÍ ĐÁNH GIÁ MỨC ĐỘ HOÀN THÀNH KH/MT HÀNG THÁNG | XƯỞNG ĐIỀU KHIỂN",
    "rows": [
        {
            "index": 1,
            "level": "Không hoàn thành nhiệm vụ",
            "description": "Đội/tổ thực hiện không hoàn thành một trong các chỉ tiêu theo kế hoạch/mục tiêu đã đăng ký hoặc vi phạm bất kỳ qui định/qui trình của Nhà máy/Công ty",
        },
        {
            "index": 2,
            "level": "Hoàn thành nhiệm vụ",
            "description": "Đội/tổ thực hiện hoàn thành các chỉ tiêu theo kế hoạch/mục tiêu đã đăng ký và\n- Không vi phạm bất kỳ qui định/qui trình của Nhà máy/Công ty",
        },
        {
            "index": 3,
            "level": "Hoàn thành tốt nhiệm vụ",
            "description": "Đội/tổ thực hiện hoàn thành nhiệm vụ và\n- Thực hiện vượt tiêu chí KR ĐK.6.11 (3 ý tưởng/CTKT)\n- Là đội/tổ có tỉ lệ tham gia trên 50% đối với ĐK.8.1 & 8.2 (*)\n- Là đội/tổ có tỉ lệ tham gia trên 50% các hoạt động phong trào chung của Xưởng (*)\n+ Tính theo tỷ lệ cá nhân tham gia\n+ Chương trình: Hội thao PVCFC",
        },
        {
            "index": 4,
            "level": "Hoàn thành xuất sắc nhiệm vụ",
            "description": "Đội/tổ thực hiện hoàn thành tốt nhiệm vụ và\n- Là đội/tổ có tỉ lệ tham gia tất cả các hoạt động tại KR ĐK.8.1 & 8.2 đạt 90% hoặc (*)\n- Có giải pháp xử lý được vấn đề phức tạp do LĐX đánh giá hoặc\n- Có giải pháp mang lại hiệu quả lớn do LĐX đánh giá",
        },
    ],
    "notes": [
        "(*) Đối với tổ trực ca điều khiển vì tính chất đi ca/kip không có mặt thường xuyên ở Nhà máy cho nên:\n- Chỉ tính tỉ lệ trên 02 KIP cụ thể là 7 nhân sự\n- Trừ nhân sự đi công tác hoặc điều ca đối với nhân sự hành chính",
    ],
}


EVALUATION_PRINCIPLES: dict[str, Any] = {
    "sheet": "NTĐG",
    "title": "NGUYÊN TẮC CHUNG TRONG QUÁ TRÌNH ĐÁNH GIÁ",
    "rows": [
        {
            "principle": "Nguyên tắc 1",
            "content": "Đối với nhóm nhân sự không thuộc các đội/tổ quản lý, QĐX sẽ tự đánh giá và QĐ sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 2",
            "content": "Đối với các đội/tổ hoàn thành đúng tiến độ/chất lượng các hạng mục công việc phát sinh với khối lượng lớn, LĐX sẽ xem xét đánh giá và phân bổ bổ sung các chỉ tiêu A1, A2 đến đội/tổ",
        },
        {
            "principle": "Nguyên tắc 3",
            "content": "Đối với các tổ chức đoàn thể, tùy vào phong trào Xưởng sẽ có đánh giá trực tiếp A1/A2 cho BT. ĐTN, TT. CĐ sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 4",
            "content": "Đối với hoạt động đoàn thể BT.ĐTN, TT. CĐ có đánh giá đoàn viên thanh niên/công đoàn viên tham gia tích cực để các đội/tổ xem xét đánh giá A1/A2 cho đoàn viên thanh niên/công đoàn viên",
        },
        {
            "principle": "Nguyên tắc 5",
            "content": "Đối với các cá nhân đi thực hiện dịch vụ bên ngoài/hỗ trợ đơn vị trong ngành:\n- Trên 3 tuần: LĐX xem xét đánh giá A1/A2\n- Dưới 3 tuần: KPI của Đội",
        },
        {
            "principle": "Nguyên tắc 6",
            "content": "Đội/tổ không hoàn thành nhiệm vụ sẽ không phân bổ KPI tháng đó",
        },
        {
            "principle": "Nguyên tắc 7",
            "content": "Đội/tổ hoàn thành tốt nhiệm vụ được phân bổ KPI nhiều hơn đội/tổ chỉ hoàn thành nhiệm vụ",
        },
        {
            "principle": "Nguyên tắc 8",
            "content": "Đội/tổ hoàn thành xuất sắc nhiệm vụ được phân bổ KPI nhiều hơn đội/tổ chỉ hoàn thành tốt nhiệm vụ",
        },
        {
            "principle": "Nguyên tắc 9",
            "content": "Đội/tổ hoàn thành xuất sắc nhiệm vụ đội/tổ trưởng sẽ được phân bổ 01 A1 (Đối với tổ trực ca chỉ tính 01 chỉ tiêu) sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 10",
            "content": "Đội/tổ hoàn thành tốt nhiệm vụ trong 02 tháng liên tiếp đội/tổ trưởng sẽ được phân bổ 01 A2 (Đối với tổ trực ca chỉ tính 01 chỉ tiêu) sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 11",
            "content": "Đội/tổ hoàn thành tốt nhiệm vụ trong 04 tháng liên tiếp đội/tổ trưởng sẽ được phân bổ 01 A1 (Đối với tổ trực ca chỉ tính 01 chỉ tiêu) sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 12",
            "content": "Đối với tháng triển khai thực hiện BDTT các nhóm theo sơ đồ tổ chức BDTT",
        },
        {
            "principle": "Nguyên tắc 13",
            "content": "Nhóm nhân sự trực Tết âm lịch được xem xét ưu tiên",
        },
        {
            "principle": "Nguyên tắc 14",
            "content": "Đối với hoạt động phong trào/Đầu mục công việc trong tháng đầu mối Xưởng không tổ chức chương trình thì không xét vào tiêu chí đánh giá của tháng",
        },
        {
            "principle": "Nguyên tắc 15",
            "content": "Đối với Tháng 12 sẽ ưu tiên đánh giá các cá nhân có thành tích nổi bật trong năm sau đó mới phân bổ chỉ tiêu đến các đội/tổ",
        },
        {
            "principle": "Nguyên tắc 16",
            "content": "Phân bổ KPI đối với cá nhân hoàn thành tốt chương trình AM do nhóm phó thường trực AM đề xuất (Không tính vào KPI của Đội/Tổ)",
        },
    ],
}


def load_evaluation_criteria() -> dict[str, Any]:
    return deepcopy(EVALUATION_CRITERIA)


def load_evaluation_principles() -> dict[str, Any]:
    return deepcopy(EVALUATION_PRINCIPLES)
