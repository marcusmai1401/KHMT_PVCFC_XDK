from app.services.okr.extraction import extract_metrics, warning_for_low_confidence, warnings_for_ambiguous_metrics


def test_extract_ratio_percentage():
    metrics = extract_metrics("Hoàn thành 382/407 hạng mục chiếm tỷ trọng 93.9%", "O2.KR2")
    assert metrics[0].kind == "scdx"
    assert metrics[0].actual == 382
    assert metrics[0].total == 407
    assert round(metrics[0].percentage or 0, 1) == 93.9


def test_low_confidence_warning():
    metric = extract_metrics("Trong tháng có 14 hạng mục được ghi nhận", "generic")[0]
    warning = warning_for_low_confidence(metric, {"row": 15})
    assert warning is not None
    assert warning["warning_type"] == "LOW_CONFIDENCE_EXTRACTION"


def test_domain_specific_stop_extraction():
    metric = extract_metrics("Hoàn thành 10 thẻ STOP, chỉ tiêu 14 thẻ", "O3.KR2")[0]
    assert metric.kind == "stop_cards"
    assert metric.actual == 10
    assert metric.target == 14
    assert metric.confidence >= 0.8


def test_domain_specific_sk_vhdn_training_extraction():
    sk = extract_metrics("Có 2 sáng kiến được công nhận", "O5.KR12")[0]
    ctkt = extract_metrics("Có 1 CTKT được công nhận", "O5.KR13")[0]
    vhdn = extract_metrics("VHDN chạy bộ có 11/13 người tham gia", "O6.KR1")[0]
    training = extract_metrics("Đào tạo 24 giờ, kế hoạch 20 giờ", "O5.KR3")[0]

    assert (sk.kind, sk.actual) == ("sk_initiatives", 2)
    assert (ctkt.kind, ctkt.actual) == ("ctkt_fi", 1)
    assert (vhdn.kind, vhdn.actual, vhdn.total) == ("vhdn", 11, 13)
    assert (training.kind, training.actual, training.target) == ("training_hours", 24, 20)


def test_specific_sk_hint_wins_over_generic_the_card_word():
    metric = extract_metrics("Có 3 thẻ sáng kiến được ghi nhận", "O5.KR12")[0]

    assert metric.kind == "sk_initiatives"
    assert metric.actual == 3


def test_ambiguous_metrics_warning():
    metrics = extract_metrics("Hoàn thành 10/12 hạng mục, phát sinh thêm 8/9 hạng mục", "O2.KR1")
    warnings = warnings_for_ambiguous_metrics(metrics, {"row": 8})

    assert len(metrics) == 2
    assert warnings
    assert warnings[0]["warning_type"] == "AMBIGUOUS_DATA"


def test_ratio_extraction_ignores_dates_but_keeps_progress_ratios():
    metrics = extract_metrics(
        "Chạy bộ 09/05: tham gia 11/13 người; ngày 23/05/2026 tham gia 10/12 người",
        "O6.KR1",
    )

    assert [(metric.actual, metric.total) for metric in metrics] == [(11, 13), (10, 12)]
