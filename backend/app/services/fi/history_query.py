"""SQL filtering shared by FI history: page before loading ORM records."""
from datetime import datetime, timezone
import unicodedata
from sqlalchemy import and_, or_, case, cast, Boolean, Integer, String, extract, func, literal, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from app.models.domain import SKCTKTModel as FI, User
from app.services.fi.service import AUTHOR_ROLES, IMPORT_ACTOR_IDS, _user_name_aliases

class NormalizeNFD(FunctionElement):
    type = String()
    inherit_cache = True


class RegexMatches(FunctionElement):
    type = Boolean()
    inherit_cache = True


@compiles(RegexMatches, "postgresql")
def _postgres_regex(element, compiler, **kw):
    value, pattern = element.clauses
    return f"({compiler.process(value, **kw)} ~ {compiler.process(pattern, **kw)})"


@compiles(RegexMatches)
def _sqlite_regex(element, compiler, **kw):
    value, pattern = element.clauses
    return f"({compiler.process(value, **kw)} REGEXP {compiler.process(pattern, **kw)})"


@compiles(NormalizeNFD, "postgresql")
def _postgres_nfd(element, compiler, **kw):
    return f"normalize({compiler.process(element.clauses, **kw)}, NFD)"


@compiles(NormalizeNFD)
def _sqlite_nfd(element, compiler, **kw):
    return f"normalize({compiler.process(element.clauses, **kw)}, 'NFD')"

def fold(column):
    # Native normalization avoids scanning a large translation alphabet for every
    # character of every row. No database extension or persisted search cache.
    decomposed = NormalizeNFD(func.coalesce(column, ""))
    unaccented = func.regexp_replace(decomposed, "[\u0300-\u036f]", "", "g")
    return func.lower(func.trim(func.translate(unaccented, "đĐ", "dD")))

def normalized(column):
    return func.regexp_replace(fold(column), r"\s+", " ", "g")

def integer(column):
    # Legacy JSON is not schema-validated; an overlong digit string must fall
    # back like any invalid date instead of raising PostgreSQL integer overflow.
    return case((and_(func.length(column).between(1, 9), func.translate(column, "0123456789", "") == ""), cast(column, Integer)), else_=None)

def expressions(db):
    users = list(db.scalars(select(User)))  # one bounded directory query, no per-FI user lookup
    db.info["fi_user_directory"] = users
    aliases = {}
    for user in users:
        if user.is_active and user.role in AUTHOR_ROLES:
            for name in _user_name_aliases(user): aliases.setdefault((user.team, name), []).append(user.id)
    team_aliases = {}
    for (team, name), ids in aliases.items():
        if len(ids) == 1:
            team_aliases.setdefault(team, {})[name] = ids[0]
    # A simple CASE evaluates the normalized name once per team. Repeating it
    # in every WHEN made legacy rows increasingly expensive as users grew.
    matches = {team: case(names, value=normalized(FI.author_name), else_=None) for team, names in team_aliases.items()}
    legacy_author = case(matches, value=FI.team, else_=None) if matches else literal(None)
    author_id = case((and_(FI.author_user_id.is_not(None), FI.author_user_id != "", FI.author_user_id.not_in(IMPORT_ACTOR_IDS)), FI.author_user_id), else_=legacy_author)
    # Extract the complete JSON path in one operation instead of repeatedly
    # serializing/reparsing intermediate JSON objects on PostgreSQL.
    raw_submitter = func.coalesce(func.nullif(FI.status_history[(0, "comments", "submitted_by")].as_string(), ""), func.nullif(FI.status_history[(0, "comments", "created_by")].as_string(), ""), func.nullif(FI.status_history[(0, "changed_by")].as_string(), ""))
    submitter_id = case((and_(raw_submitter.is_not(None), raw_submitter.not_in(IMPORT_ACTOR_IDS)), raw_submitter), (FI.is_historical_import.is_(True), author_id), else_=raw_submitter)
    names = [(submitter_id == u.id, u.full_name or u.display_name or "") for u in users]
    submitter_name = case(*names, else_=case((FI.is_historical_import.is_(True), FI.author_name), else_="")) if names else FI.author_name
    month_text = cast(FI.status_history[(0, "comments", "registration_month")].as_string(), String)
    # Month has only twelve valid values. Validate those directly instead of
    # repeating a nested safe-integer CASE for its lower and upper bounds.
    valid_month = and_(func.length(month_text) <= 9, func.ltrim(month_text, "0").in_([str(month) for month in range(1, 13)]))
    raw_month = cast(month_text, Integer)
    raw_year = integer(FI.status_history[(0, "comments", "registration_year")].as_string())
    month = case((valid_month, raw_month), else_=extract("month", FI.created_at))
    year = case((valid_month, func.coalesce(func.nullif(raw_year,0), extract("year", FI.created_at), FI.khmt_year, datetime.now(timezone.utc).year)), else_=func.coalesce(extract("year", FI.created_at), func.nullif(raw_year,0), datetime.now(timezone.utc).year))
    decision = case((FI.status.in_(["Approved","Completed"]), "approved"), (FI.status == "Rejected", "rejected"), (FI.status == "Deferred", "deferred"), else_="pending")
    plan = normalized(FI.completion_plan)
    negative_pattern = "chua thuc hien|chua hoan thanh|du kien|co the thuc hien|se thuc hien"
    not_done = RegexMatches(plan, literal(negative_pattern))
    done_pattern = r"(^|[^a-z0-9_])(da (hoan thanh|thuc hien|trien khai|lap))([^a-z0-9_]|$)|^hoan thanh([^a-z0-9_]|$)"
    plan_done = RegexMatches(plan, literal(done_pattern))
    done = case((FI.status == "Completed", True), (FI.completed_at.is_not(None), True), (plan_done, ~not_done), else_=False)
    return dict(month=month, year=year, decision=decision, done=done, author_id=author_id, submitter_id=submitter_id, submitter_name=submitter_name), users

def person_filter(keys, identity, name):
    clauses = []
    for key in keys:
        lower = key.lower()
        if lower.startswith("id:"):
            clauses.append(func.lower(identity) == lower[3:])
        elif lower.startswith("name:"):
            raw = key[5:].split(":team:",1)
            clause = normalized(name) == " ".join(_fold(raw[0]).split())
            if len(raw) == 2: clause = and_(clause, fold(FI.team) == _fold(raw[1]))
            clauses.append(clause)
        else:
            clauses.append(or_(identity == key, fold(name).contains(_fold(key), autoescape=True)))
    return or_(*clauses)

def _fold(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.strip().casefold().replace("đ","d")) if unicodedata.category(c) != "Mn")
