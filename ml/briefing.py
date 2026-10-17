"""Next-day safety briefing written from the risk JSON.

The models decide; the language model only explains. Each briefing starts from a fact sheet built
from the risk JSON, and a checker rejects any draft that uses a number, decision or hazard that
isn't in that fact sheet. A rejected draft gets one retry with the checker's feedback, then falls
back to a deterministic template, which always passes.

Backends, tried in order by write_briefing(..., backend="auto"):
  local    a small open model running on Apple Silicon via MLX (Hugging Face weights)
  gemini   Google Gemini over REST, when GEMINI_API_KEY is set
  template plain-text template; always available

    uv run python briefing.py EIA-56407                 # tomorrow's briefing for one site
    uv run python briefing.py EIA-56407 --backend template
"""

from __future__ import annotations

import argparse
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import date as Date
from typing import Callable

import requests

# Picked by pipeline/16_briefing_bakeoff.py: as faithful as Qwen3-4B-Instruct-2507, far cleaner prose,
# and it can also read photos.
LOCAL_MODEL = os.environ.get("BRIEFING_MODEL", "mlx-community/Qwen3.5-4B-MLX-4bit")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

HAZARD_NAMES = {
    "heat": "heat",
    "convective": "thunderstorms and lightning",
    "flood": "flooding",
    "wildfire": "wildfire",
    "wildlife": "wildlife",
}
DECISION_LABEL = {"go": "GO", "caution": "CAUTION", "no-go": "NO-GO"}
CONCERN_LEVEL = 2.0  # a sub-score at or above this is called out as a concern
ANIMALS = {"alligator": "alligators", "venomous_snake": "venomous snakes", "bear": "bears"}

ACTIONS = {
    "heat": "Schedule heavy work early in the day, and give crews water, rest and shade at least once an hour.",
    "convective": "Have a lightning plan: stop work and shelter when thunder is heard, and wait 30 minutes "
                  "after the last thunder before restarting.",
    "flood": "Check access roads and low crossings before moving equipment in, and never drive through "
             "standing water.",
    "wildfire": "Avoid hot work without a fire watch, and keep a fire extinguisher on every vehicle.",
    "wildlife": "Check around water, brush and parked equipment for {animals} before starting, and keep clear "
                "of any you see.",
}

SYSTEM_PROMPT = """You write next-day safety briefings for utility field crews.
Rules:
- Use only the facts given. Do not add any hazard, number, time, place, or advice that is not in the facts.
- Copy every number exactly as written in the facts.
- Start with the decision in capital letters exactly as given, e.g. "Decision: CAUTION".
- Write 3 to 5 short sentences of plain text. No markdown, no bullet points, no headings.
- Explain the decision using the "Why this decision" fact.
- Then give the main concern and its key reasons, the best work window and the recommended actions.
- Describe things with the same words as the facts (for example "sightings", not "incidents")."""


@dataclass
class Facts:
    site_name: str
    decision: str
    index: float
    concerns: list[str]
    reasons: list[str]
    actions: list[str]
    alerts: list[str]
    animals: list[str]
    text: str = ""
    date_text: str = ""
    windows: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)


def _fmt(v: float) -> str:
    return f"{v:.1f}"


def build_facts(risk: dict, site: dict, crew_reports: list[dict] | None = None) -> Facts:
    """Everything a briefing may say, rendered as the text the language model sees."""
    day = Date.fromisoformat(risk["date"])
    date_text = f"{day:%A}, {day:%B} {day.day}"
    decision = DECISION_LABEL[risk["recommendation"]]
    scores = {h: float(v) for h, v in risk["sub_scores"].items()}
    concerns = sorted((h for h, v in scores.items() if v >= CONCERN_LEVEL), key=lambda h: -scores[h])
    reasons = [r["text"] for r in risk.get("reasons", [])]

    animals = []
    for r in risk.get("reasons", []):
        f = r.get("factor", "")
        if f.startswith("gbif_") and f[5:] in ANIMALS:
            animals.append(ANIMALS[f[5:]])
    for r in crew_reports or []:
        a = str(r.get("animal", "")).strip().lower()
        if a and a not in " ".join(animals):
            animals.append(a + "s" if not a.endswith("s") else a)
    animals = list(dict.fromkeys(animals))

    actions = []
    for h in concerns:
        a = ACTIONS.get(h)
        if a:
            actions.append(a.format(animals=" and ".join(animals) or "animals"))

    alerts = []
    for a in risk.get("overrides", []) or []:
        # Lower-case effect: capitalised decision words are reserved for the decision itself.
        what = a.get("message") or a.get("type", "alert")
        alerts.append(f"{str(a.get('type', 'alert')).capitalize()} alert: {what} "
                      f"(sets the decision to at least {a.get('effect', 'caution')})")

    from score import recommendation  # the index-only decision, before alerts

    by_index = DECISION_LABEL[recommendation(round(float(risk["hazard_index"]), 1))]
    if alerts and by_index != decision:
        why = "a live alert sets it (the hazard index alone would give " + by_index.lower() + ")"
    elif concerns:
        why = "the hazard index, driven mainly by " + HAZARD_NAMES[concerns[0]]
    else:
        why = "the hazard index; no hazard stands out"
    location = ", ".join(x for x in [site.get("county") and f"{site['county']} County", site.get("state")] if x)
    lines = [
        f"Site: {site.get('name', risk['site_id'])}" + (f", {location}" if location else ""),
        f"Date: {date_text}",
        f"Decision: {decision}",
        f"Why this decision: {why}",
        f"Hazard index: {_fmt(risk['hazard_index'])} out of 10",
        "Scores out of 10: " + ", ".join(f"{HAZARD_NAMES[h]} {_fmt(v)}" for h, v in scores.items()),
        "Main concerns: " + (", ".join(HAZARD_NAMES[h] for h in concerns) if concerns else "none, all scores are low"),
    ]
    if reasons:
        lines.append("Reasons:")
        lines += [f"- {r}" for r in reasons]
    plan = risk.get("work_plan") or {}
    if plan.get("work_windows") or plan.get("avoid"):
        lines.append("Work plan (local time):")
        if plan.get("work_windows"):
            lines.append("- Best work windows: " + "; ".join(w["text"] for w in plan["work_windows"]))
        lines += [f"- Avoid: {a['text']}" for a in plan.get("avoid", [])]
    if alerts:
        lines.append("Live alerts:")
        lines += [f"- {a}" for a in alerts]
    if actions:
        lines.append("Recommended actions:")
        lines += [f"- {a}" for a in actions]
    return Facts(site_name=site.get("name", risk["site_id"]), decision=decision, index=risk["hazard_index"],
                 concerns=concerns, reasons=reasons, actions=actions, alerts=alerts, animals=animals,
                 text="\n".join(lines), date_text=date_text, scores=scores,
                 windows=[w["text"] for w in plan.get("work_windows", [])],
                 avoid=[a["text"] for a in plan.get("avoid", [])])


# ---------------------------------------------------------------------------
# Template (always correct)
# ---------------------------------------------------------------------------

def template_briefing(f: Facts) -> str:
    parts = [f"Decision: {f.decision} for {f.site_name} on {f.date_text} "
             f"(hazard index {_fmt(f.index)} out of 10)."]
    if f.concerns:
        main = f.concerns[0]
        parts.append(f"The main concern is {HAZARD_NAMES[main]} ({_fmt(f.scores[main])} out of 10)"
                     + (f", also watch {', '.join(HAZARD_NAMES[h] for h in f.concerns[1:])}." if len(f.concerns) > 1 else "."))
    else:
        parts.append("No hazard stands out; all scores are low.")
    if f.reasons:
        parts.append(" ".join(r.rstrip(".") + "." for r in f.reasons[:3]))
    if f.windows:
        parts.append("Best work window: " + "; ".join(f.windows) + ".")
    for a in f.avoid[:2]:
        parts.append(a.rstrip(".") + ".")
    for a in f.alerts:
        parts.append(a.rstrip(".") + ".")
    parts += f.actions[:2]
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Checker
# ---------------------------------------------------------------------------

_NUM = re.compile(r"(?<![\w.])\d+(?:\.\d+)?")
# Phenomena a draft must not bring up unless the facts do (whole words, so "bearing" isn't "bear").
_TERMS = {
    "tornado": r"\btornado(es)?\b", "hail": r"\bhail\b", "hurricane": r"\bhurricanes?\b",
    "tropical storm": r"\btropical\b", "snow": r"\bsnow\w*", "ice": r"\bice\b|\bicy\b",
    "freezing": r"\bfreez\w*", "frost": r"\bfrost\w*", "smoke": r"\bsmok\w*", "evacuation": r"\bevacuat\w*",
    "earthquake": r"\bearthquakes?\b", "landslide": r"\b(land|mud)slides?\b", "fog": r"\bfog\w*",
    "alligator": r"\balligators?\b|\bgators?\b", "snake": r"\b(rattle)?snakes?\b", "bear": r"\bbears?\b",
    "power line": r"\b(power|downed) lines?\b",
}


def _numbers(text: str) -> set[float]:
    return {float(x) for x in _NUM.findall(text)}


def check_briefing(draft: str, f: Facts) -> list[str]:
    """Problems with a draft; an empty list means it may be sent."""
    problems = []
    allowed = _numbers(f.text)
    for n in sorted(_numbers(draft) - allowed):
        problems.append(f"number {n:g} is not in the facts")

    labels = {"NO-GO": r"\bNO-GO\b", "CAUTION": r"\bCAUTION\b", "GO": r"(?<!NO-)\bGO\b"}
    present = {k for k, rx in labels.items() if re.search(rx, draft)}
    if f.decision not in present:
        problems.append(f"decision {f.decision} is missing")
    for other in sorted(present - {f.decision}):
        problems.append(f"states decision {other}, but the decision is {f.decision}")

    low_facts = f.text.lower()
    low_draft = draft.lower()
    for name, rx in _TERMS.items():
        if re.search(rx, low_draft) and not re.search(rx, low_facts):
            problems.append(f"mentions {name}, which is not in the facts")

    if f.alerts and "alert" not in low_draft:
        problems.append("leaves out the live alert that sets the decision")
    if not f.alerts and re.search(r"\balerts?\b", low_draft):
        problems.append("mentions an alert, but there is none")
    for label in ("Why this decision:", "Main concerns:", "Scores out of 10:", "Recommended actions:",
                  "Work plan (local time):", "Live alerts:", "Reasons:"):
        if label.lower() in low_draft:
            problems.append(f"copies the fact label '{label}' instead of writing sentences")

    if f.concerns:
        main_words = {"heat": ["heat"], "convective": ["thunder", "lightning", "storm"], "flood": ["flood"],
                      "wildfire": ["fire"], "wildlife": ["wildlife", "alligator", "snake", "bear", "animal"]}
        if not any(w in low_draft for w in main_words[f.concerns[0]]):
            problems.append(f"does not mention the main concern ({HAZARD_NAMES[f.concerns[0]]})")

    words = len(draft.split())
    if words < 12 or words > 170:
        problems.append(f"length {words} words (want 12-170)")
    return problems


# ---------------------------------------------------------------------------
# Language-model backends
# ---------------------------------------------------------------------------

class LocalLLM:
    """A Hugging Face model in MLX format, run on the Mac's GPU. Loaded once per process."""

    _cache: dict[str, "LocalLLM"] = {}
    _load_lock = threading.Lock()

    def __init__(self, repo: str = LOCAL_MODEL):
        from mlx_lm import load  # Apple Silicon only

        self.repo = repo
        self.model, self.tokenizer = load(repo)
        self._lock = threading.Lock()  # one generation at a time on the GPU (the API is multi-threaded)

    @classmethod
    def get(cls, repo: str = LOCAL_MODEL) -> "LocalLLM":
        with cls._load_lock:
            if repo not in cls._cache:
                cls._cache[repo] = cls(repo)
            return cls._cache[repo]

    def __call__(self, system: str, user: str, max_tokens: int = 260) -> str:
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        prompt = self.tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False,
                                                    enable_thinking=False)
        with self._lock:
            out = generate(self.model, self.tokenizer, prompt=prompt, max_tokens=max_tokens,
                           sampler=make_sampler(temp=0.0), verbose=False)
        return _clean(out)


def gemini_generate(system: str, user: str, max_tokens: int = 400) -> str:
    key = os.environ["GEMINI_API_KEY"]
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        json={"systemInstruction": {"parts": [{"text": system}]},
              "contents": [{"role": "user", "parts": [{"text": user}]}],
              "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens}},
        timeout=30,
    )
    r.raise_for_status()
    parts = r.json()["candidates"][0]["content"]["parts"]
    return _clean("".join(p.get("text", "") for p in parts))


def _clean(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"^\s*[-*•]\s+", "", text, flags=re.M)
    return " ".join(text.split())


def _user_prompt(f: Facts, feedback: list[str] | None = None) -> str:
    # Situation-specific instructions only when they apply: small models follow conditional rules
    # even when the condition is false (e.g. inventing an alert on a quiet day).
    extra = []
    if f.alerts:
        extra.append("Say that the live alert sets the decision, right after the decision.")
        if not f.concerns:
            extra.append("Apart from the alert, no hazard stands out.")
    elif not f.concerns:
        extra.append("There is no main concern: say conditions look good.")
    msg = f"Facts:\n{f.text}\n\nWrite the briefing." + ("\n" + " ".join(extra) if extra else "")
    if feedback:
        msg += ("\n\nYour previous draft was rejected for these reasons:\n"
                + "\n".join(f"- {p}" for p in feedback)
                + "\nRewrite it using only the facts above.")
    return msg


def _draft_with_checks(gen: Callable[[str, str], str], f: Facts, retries: int) -> tuple[str, list[str], int]:
    draft, problems, attempts = "", ["not attempted"], 0
    feedback = None
    for attempts in range(1, retries + 2):
        draft = gen(SYSTEM_PROMPT, _user_prompt(f, feedback))
        problems = check_briefing(draft, f)
        if not problems:
            break
        feedback = problems
    return draft, problems, attempts


def write_briefing(risk: dict, site: dict, backend: str = "auto", retries: int = 1,
                   local_repo: str = LOCAL_MODEL, crew_reports: list[dict] | None = None) -> dict:
    """Briefing text plus where it came from and what the checker found."""
    f = build_facts(risk, site, crew_reports)
    order = {"auto": ["local", "gemini"], "local": ["local"], "gemini": ["gemini"], "template": []}[backend]
    tried = []
    for b in order:
        t0 = time.time()
        try:
            if b == "local":
                gen = LocalLLM.get(local_repo)
                source = f"local:{local_repo.split('/')[-1]}"
            else:
                if not os.environ.get("GEMINI_API_KEY"):
                    continue
                gen, source = gemini_generate, f"gemini:{GEMINI_MODEL}"
            draft, problems, attempts = _draft_with_checks(gen, f, retries)
        except Exception as e:  # noqa: BLE001  (missing MLX, network, quota: fall through)
            tried.append({"backend": b, "error": f"{type(e).__name__}: {e}"[:200]})
            continue
        tried.append({"backend": b, "attempts": attempts, "problems": problems, "seconds": round(time.time() - t0, 2)})
        if not problems:
            return {"briefing": draft, "source": source, "facts": f.text, "tried": tried}
    text = template_briefing(f)
    assert not check_briefing(text, f), check_briefing(text, f)
    return {"briefing": text, "source": "template", "facts": f.text, "tried": tried}


def main() -> None:
    import json

    import score

    ap = argparse.ArgumentParser()
    ap.add_argument("site_id")
    ap.add_argument("--date", type=Date.fromisoformat, default=None)
    ap.add_argument("--backend", default="auto", choices=["auto", "local", "gemini", "template"])
    args = ap.parse_args()
    risk = score.score_site(args.site_id, args.date)
    site = score.get_models().site(args.site_id)
    print(json.dumps(write_briefing(risk, site, args.backend), indent=2))


if __name__ == "__main__":
    main()
