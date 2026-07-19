from typing import Any, Literal, TypedDict


ObjectiveCode = Literal["O1", "O2", "O3", "O4", "O5", "O6"]
ObjectiveStatus = Literal["completed", "at_risk", "failed", "no_plan", "no_data"]
DataState = Literal["ready", "partial", "no_plan", "no_data"]
VisualKind = Literal[
    "status_grid",
    "metric_table",
    "bar_line_chart",
    "bar_chart",
    "line_chart",
    "training_bar_chart",
    "radar_chart",
    "narrative_card",
    "progress_card",
    "kpi_badges",
    "sap_compliance",
]


VALID_OBJECTIVE_CODES: tuple[ObjectiveCode, ...] = ("O1", "O2", "O3", "O4", "O5", "O6")
VALID_OBJECTIVE_STATUSES: tuple[ObjectiveStatus, ...] = ("completed", "at_risk", "failed", "no_plan", "no_data")
VALID_DATA_STATES: tuple[DataState, ...] = ("ready", "partial", "no_plan", "no_data")
VALID_VISUAL_KINDS: tuple[VisualKind, ...] = (
    "status_grid",
    "metric_table",
    "bar_line_chart",
    "bar_chart",
    "line_chart",
    "training_bar_chart",
    "radar_chart",
    "narrative_card",
    "progress_card",
    "kpi_badges",
    "sap_compliance",
)

REQUIRED_VISUAL_KINDS_BY_OBJECTIVE: dict[ObjectiveCode, tuple[VisualKind, ...]] = {
    "O1": ("status_grid",),
    "O2": ("metric_table", "bar_line_chart"),
    "O3": ("bar_line_chart", "line_chart"),
    "O4": ("narrative_card",),
    "O5": ("training_bar_chart", "radar_chart", "narrative_card"),
    "O6": ("progress_card", "bar_chart"),
}


class VisualBlock(TypedDict):
    id: str
    kind: VisualKind
    title: str
    data_state: DataState
    empty_message: str | None
    source: str | None
    payload: dict[str, Any]


class ObjectiveSection(TypedDict):
    objective_code: ObjectiveCode
    title: str
    status: ObjectiveStatus
    conclusion: str | None
    visuals: list[VisualBlock]
    notes: list[str]
    source_references: list[str]
