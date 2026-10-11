#!/usr/bin/env python3
"""Precompute ClinVar-labeled missense variants for the explorer.

The EBI Proteins API variation endpoint is too large to fetch from the browser
(BRCA1 is ~55 MB and takes minutes; its filter parameters are ignored), so this
script downloads it once per protein and writes a compact file:

    data/variants/<ACCESSION>.json
    data/variants/index.json        (which accessions have variant data)

Usage:
    python3 scripts/fetch_variants.py P04637 P38398 P13569
    python3 scripts/fetch_variants.py --refresh P04637   # ignore the raw cache

Filtering rules (see README for the reasoning):
  * missense only, single residue
  * labels from ClinVar only (Ensembl labels attach to a genomic position and can
    leak from a different, more damaging allele at the same site)
  * Pathogenic + Likely pathogenic -> "pathogenic"; Benign + Likely benign -> "benign";
    uncertain / conflicting -> dropped
  * drop entries whose ClinVar protein change isn't a clean substitution
    (e.g. merged with a frameshift such as p.Asp48Glyfs)
  * drop entries whose wild-type residue doesn't match the UniProt sequence
"""

import argparse
import datetime as dt
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

API = "https://www.ebi.ac.uk/proteins/api/variation/{}"
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"          # gitignored download cache
OUT_DIR = ROOT / "data" / "variants"

PATHOGENIC = {"Pathogenic", "Likely pathogenic"}
BENIGN = {"Benign", "Likely benign"}
CLEAN_HGVS = re.compile(r"^p\.[A-Z][a-z]{2}\d+[A-Z][a-z]{2}$")
UNINFORMATIVE_DISEASES = {"not provided", "not specified", ""}


def download(accession: str, refresh: bool) -> dict:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache = RAW_DIR / f"{accession}.json"
    if cache.exists() and not refresh:
        print(f"  using cached {cache.relative_to(ROOT)}")
    else:
        print(f"  downloading {API.format(accession)} (large proteins take minutes)…")
        req = urllib.request.Request(API.format(accession), headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as res, open(cache, "wb") as out:
            while chunk := res.read(1 << 20):
                out.write(chunk)
        print(f"  saved {cache.stat().st_size / 1e6:.1f} MB")
    return json.loads(cache.read_text())


def clinvar_class(feature: dict) -> str | None:
    labels = {
        c["type"]
        for c in feature.get("clinicalSignificances") or []
        if "ClinVar" in c.get("sources", [])
    }
    if labels & PATHOGENIC and not labels & BENIGN:
        return "pathogenic"
    if labels & BENIGN and not labels & PATHOGENIC:
        return "benign"
    return None


def process(doc: dict) -> tuple[list[dict], Counter]:
    seq = doc["sequence"]
    stats = Counter()
    merged: dict[tuple, dict] = {}
    seen_classes: dict[tuple, set] = defaultdict(set)

    for f in doc["features"]:
        if f.get("consequenceType") != "missense" or f["begin"] != f["end"]:
            continue
        stats["missense"] += 1
        cls = clinvar_class(f)
        if cls is None:
            continue
        stats["clinvar_labeled"] += 1

        clinvar_hgvs = [
            l["loc"] for l in f.get("locations", [])
            if l.get("source") == "ClinVar" and l["loc"].startswith("p.")
        ]
        if any(not CLEAN_HGVS.match(h) for h in clinvar_hgvs):
            stats["dropped_not_clean_missense"] += 1
            continue

        pos, wt, mt = int(f["begin"]), f["wildType"], f["mutatedType"]
        if pos > len(seq) or seq[pos - 1] != wt:
            stats["dropped_sequence_mismatch"] += 1
            continue

        key = (pos, wt, mt)
        seen_classes[key].add(cls)
        v = merged.setdefault(key, {"pos": pos, "from": wt, "to": mt, "class": cls,
                                    "significance": set(), "diseases": set(), "clinvar": set()})
        v["significance"].update(
            c["type"] for c in f.get("clinicalSignificances") or [] if "ClinVar" in c.get("sources", []))
        v["diseases"].update(
            d["value"] for d in f.get("descriptions") or []
            if "ClinVar" in d.get("sources", []) and d["value"].strip().lower() not in UNINFORMATIVE_DISEASES)
        v["clinvar"].update(x["id"] for x in f.get("xrefs") or [] if x.get("name") == "ClinVar")

    variants = []
    for key, v in sorted(merged.items()):
        if len(seen_classes[key]) > 1:
            stats["dropped_conflicting"] += 1
            continue
        variants.append({
            "pos": v["pos"], "from": v["from"], "to": v["to"], "class": v["class"],
            "significance": sorted(v["significance"]),
            "diseases": sorted(v["diseases"]),
            "clinvar": sorted(v["clinvar"])[:5],
        })
        stats[v["class"]] += 1
    return variants, stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("accessions", nargs="+")
    ap.add_argument("--refresh", action="store_true", help="re-download instead of using data/raw cache")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index_path = OUT_DIR / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}

    for acc in (a.strip().upper() for a in args.accessions):
        print(f"{acc}")
        try:
            doc = download(acc, args.refresh)
        except Exception as e:  # keep going with the other accessions
            print(f"  FAILED: {e}", file=sys.stderr)
            continue
        variants, stats = process(doc)
        out = {
            "accession": acc,
            "gene": doc.get("geneName"),
            "protein": doc.get("proteinName"),
            "sequenceLength": len(doc["sequence"]),
            "source": "EBI Proteins API /variation; ClinVar clinical significance, missense only",
            "generated": dt.date.today().isoformat(),
            "stats": dict(stats),
            "variants": variants,
        }
        path = OUT_DIR / f"{acc}.json"
        path.write_text(json.dumps(out, separators=(",", ":")))
        index[acc] = {"gene": out["gene"], "pathogenic": stats["pathogenic"], "benign": stats["benign"],
                      "generated": out["generated"]}
        print(f"  {stats['pathogenic']} pathogenic, {stats['benign']} benign "
              f"(of {stats['missense']} missense) -> {path.relative_to(ROOT)} "
              f"({path.stat().st_size / 1e3:.0f} KB)")
        dropped = {k: v for k, v in stats.items() if k.startswith("dropped")}
        if dropped:
            print(f"  dropped: {dropped}")

    index_path.write_text(json.dumps(dict(sorted(index.items())), indent=1))


if __name__ == "__main__":
    main()
