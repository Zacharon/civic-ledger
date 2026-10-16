"""Cuts the committed test fixtures from real source files (run once, offline).

Usage: python -I cut_fixtures.py <raw-dir> <fixtures-dir>
<raw-dir> holds the files exactly as downloaded on 2026-10-16 (legislators-*.json,
HS119_*.csv, cn26.zip ... independent_expenditure_2026.csv, BILLSTATUS-119-*.zip).
`python -I cut_fixtures.py <raw-dir> <fixtures-dir> summary` cuts only
candidate_summary_2026.csv, for the candidates already in fec-bulk/weball26.zip.
Rows are selected, never edited, so every fixture line is a real source line.
"""

import csv
import io
import json
import sys
import zipfile
from pathlib import Path

RAW = Path(sys.argv[1])
OUT = Path(sys.argv[2])

# Real members chosen for edge cases (see README.md in this folder).
PEOPLE = ["B001282", "H001096", "V000133", "K000401", "N000147", "C000127", "A000375"]


def write_zip(path: Path, inner: str, text: str, encoding: str = "latin-1") -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(inner, text.encode(encoding))


def fec_lines(name: str, inner: str) -> list[str]:
    with zipfile.ZipFile(RAW / name) as z:
        return io.TextIOWrapper(z.open(inner), encoding="latin-1", newline="").read().splitlines()


def legislators() -> None:
    out = OUT / "congress-legislators"
    out.mkdir(parents=True, exist_ok=True)
    current = json.loads((RAW / "legislators-current.json").read_text(encoding="utf-8"))
    historical = json.loads((RAW / "legislators-historical.json").read_text(encoding="utf-8"))
    picked = [p for p in current if p["id"]["bioguide"] in PEOPLE]
    no_party = next(p for p in historical if any("party" not in t for t in p["terms"]))
    unknown_district = next(p for p in historical if any(t.get("district") == -1 for t in p["terms"]))
    files = (("legislators-current.json", picked), ("legislators-historical.json", [no_party, unknown_district]))
    for name, people in files:
        with open(out / name, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(people, indent=1, ensure_ascii=False) + "\n")


def voteview(rollcall_keys: set[tuple[str, str, str]]) -> None:
    out = OUT / "voteview"
    out.mkdir(parents=True, exist_ok=True)
    with open(RAW / "HS119_members.csv", encoding="utf-8", newline="") as f:
        members = list(csv.reader(f))
    header, rows = members[0], members[1:]
    bio = header.index("bioguide_id")
    keep = [r for r in rows if r[bio] in PEOPLE or r[1] == "President"]
    icpsrs = {(r[1], r[2]) for r in keep}
    write_csv(out / "HS119_members.csv", header, keep)

    with open(RAW / "HS119_rollcalls.csv", encoding="utf-8", newline="") as f:
        rollcalls = list(csv.reader(f))
    header, rows = rollcalls[0], rollcalls[1:]
    keep = [r for r in rows if (r[1], r[4], r[5]) in rollcall_keys]
    numbers = {(r[1], r[2]) for r in keep}
    write_csv(out / "HS119_rollcalls.csv", header, keep)

    with open(RAW / "HS119_votes.csv", encoding="utf-8", newline="") as f:
        votes = list(csv.reader(f))
    header, rows = votes[0], votes[1:]
    picked = [r for r in rows if (r[1], r[2]) in numbers and (r[1], r[3]) in icpsrs]
    # One real vote by a member outside the fixture: exercises "unmatched member".
    stranger = next(r for r in rows if (r[1], r[2]) in numbers and (r[1], r[3]) not in icpsrs)
    write_csv(out / "HS119_votes.csv", header, picked + [stranger])


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def billstatus() -> set[tuple[str, str, str]]:
    out = OUT / "govinfo-billstatus"
    out.mkdir(parents=True, exist_ok=True)
    wanted = {
        "hjres": ["BILLSTATUS-119hjres130.xml", "BILLSTATUS-119hjres142.xml"],
        "hres": ["BILLSTATUS-119hres893.xml"],
        "s": ["BILLSTATUS-119s5531.xml"],
    }
    for t in ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"]:
        with zipfile.ZipFile(RAW / f"BILLSTATUS-119-{t}.zip") as src, zipfile.ZipFile(
            out / f"BILLSTATUS-119-{t}.zip", "w", zipfile.ZIP_DEFLATED
        ) as dst:
            for name in wanted.get(t, []):
                dst.writestr(name, src.read(name))
    # Rollcalls the fixture bills recorded (chamber, session, clerk number), minus House
    # 1/302 (hres893) so one recorded vote has no rollcall; plus HR 1 passage (unlinked).
    return {
        ("House", "1", "294"),
        ("Senate", "1", "623"),
        ("House", "2", "56"),
        ("Senate", "2", "36"),
        ("Senate", "2", "37"),
        ("House", "1", "145"),
    }


def fec() -> None:
    out = OUT / "fec-bulk"
    out.mkdir(parents=True, exist_ok=True)
    pas2 = [l.split("|") for l in fec_lines("pas226.zip", "itpas2.txt")]
    by = lambda pred: [r for r in pas2 if pred(r)]  # noqa: E731
    picked: list[list[str]] = []
    picked += by(lambda r: r[0] == "C00004861" and r[17] == "B897712")  # contribution + refund
    picked += by(lambda r: r[0] == "C00692327" and r[17] == "SB23.1" and r[2] == "M4")  # TRAN_ID reuse
    picked += by(lambda r: r[0] == "C00679167" and r[17] == "SB23.4553")  # N + A same report
    picked += by(lambda r: r[0] == "C00193441" and r[17] == "AAF694CEB100445C8A7D")  # re-report
    picked += [next(r for r in pas2 if r[19] == "X" and r[5] == "24K")]  # memo
    picked += [next(r for r in pas2 if r[5] == "24E")]  # IE: excluded type
    ccl = [l.split("|") for l in fec_lines("ccl26.zip", "ccl.txt")]
    linked = {}
    for r in ccl:
        linked.setdefault(r[3], set()).add(r[0])
    via_other = next(r for r in pas2 if r[5] == "24K" and not r[16] and len(linked.get(r[15], ())) == 1)
    # Recipient committee linked to several candidates (joint): no single recipient.
    unresolved = next(
        r for r in pas2 if r[5] == "24K" and not r[16] and len(linked.get(r[15], ())) > 1 and r[19] != "X"
    )
    picked += [via_other, unresolved]
    # An individual payee (ENTITY_TP=IND): its NAME must never reach the database.
    picked += [next(r for r in pas2 if r[6] == "IND" and r[5] in ("24K", "24Z") and r[19] != "X")]
    person_ids = {"S6KY00286", "H0KY06104", "H2WY00166", "S6WY00209", "H8NJ02166", "H6TX19099", "H0DC00058", "S8WA00194"}
    for cand in sorted(person_ids):
        picked += [r for r in pas2 if r[16] == cand and r[19] != "X"][:2]

    recipients = {r[16] for r in picked if r[16]} | person_ids | linked.get(via_other[15], set())
    committees = {r[0] for r in picked} | {via_other[15], unresolved[15]}

    with open(RAW / "independent_expenditure_2026.csv", encoding="utf-8", newline="") as f:
        ie = list(csv.reader(f))
    header, rows = ie[0], ie[1:]
    col = {name: i for i, name in enumerate(header)}
    pick_ie = lambda pred, n=50: [r for r in rows if pred(r)][:n]  # noqa: E731
    chosen = []
    chosen += pick_ie(lambda r: r[col["spe_id"]] == "C00935767" and r[col["tran_id"]] == "SE.4124")
    chosen += pick_ie(lambda r: r[col["spe_id"]] == "C90023581" and r[col["tran_id"]] == "F57.000002"
                      and r[col["file_num"]] in ("2014703", "2014732", "2014700"))
    chosen += pick_ie(lambda r: r[col["spe_id"]] == "C00608943" and r[col["tran_id"]] == "1", 2)
    chosen += pick_ie(lambda r: r[col["exp_amo"]] == "9000000000", 1)
    chosen += pick_ie(lambda r: not r[col["cand_id"]].strip() and r[col["exp_amo"]] != "9000000000", 1)
    chosen += pick_ie(lambda r: not r[col["sup_opp"]].strip(), 1)
    chosen += pick_ie(lambda r: r[col["cand_id"]] in person_ids, 3)
    write_csv(out / "independent_expenditure_2026.csv", header, chosen)
    committees |= {r[col["spe_id"]] for r in chosen}
    recipients |= {r[col["cand_id"]] for r in chosen if r[col["cand_id"]].strip()}

    cn = [l for l in fec_lines("cn26.zip", "cn.txt") if l.split("|")[0] in recipients]
    committees |= {l.split("|")[9] for l in cn if l.split("|")[9]}
    ccl_keep = [l for l in fec_lines("ccl26.zip", "ccl.txt") if l.split("|")[0] in recipients or l.split("|")[3] in (via_other[15], unresolved[15])]
    committees |= {l.split("|")[3] for l in ccl_keep}
    cm = [l for l in fec_lines("cm26.zip", "cm.txt") if l.split("|")[0] in committees]
    weball = [l for l in fec_lines("weball26.zip", "weball26.txt") if l.split("|")[0] in recipients]

    write_zip(out / "cn26.zip", "cn.txt", "\n".join(cn) + "\n")
    write_zip(out / "cm26.zip", "cm.txt", "\n".join(cm) + "\n")
    write_zip(out / "ccl26.zip", "ccl.txt", "\n".join(ccl_keep) + "\n")
    write_zip(out / "weball26.zip", "weball26.txt", "\n".join(weball) + "\n")
    write_zip(out / "pas226.zip", "itpas2.txt", "\n".join("|".join(r) for r in picked) + "\n")


# Filer error: negative unitemized amount (Individual_Unitemized_Contribution -7309.83).
SUMMARY_OUT_OF_RANGE = "H4MO05366"


def summary() -> None:
    out = OUT / "fec-bulk"
    with zipfile.ZipFile(out / "weball26.zip") as z:
        ids = {l.split("|")[0] for l in io.TextIOWrapper(z.open("weball26.txt"), encoding="latin-1").read().splitlines()}
    ids.add(SUMMARY_OUT_OF_RANGE)
    lines = (RAW / "candidate_summary_2026.csv").read_text(encoding="latin-1").splitlines(keepends=True)
    keep = [l for l in lines[1:] if next(csv.reader([l]))[2] in ids]
    (out / "candidate_summary_2026.csv").write_text(lines[0] + "".join(keep), encoding="latin-1", newline="")


if __name__ == "__main__":
    if sys.argv[3:] == ["summary"]:
        summary()
        sys.exit(0)
    legislators()
    voteview(billstatus())
    fec()
    print("fixtures written to", OUT)
