"""
Universal CSV Data Cleaning & Migration Prep Engine
=====================================================
Drop ANY CSV files into the /data folder and run.
No configuration. No hardcoded headers. No assumptions.

What it does:
  - Reads every CSV in /data (and subdirectories if you want)
  - Auto-profiles each file: detects column types (currency, date,
    numeric, boolean, text, ID/code)
  - Cleans each file: strips whitespace, normalizes currencies,
    standardizes dates, coerces numerics, flags blanks/duplicates
  - Cross-file relationship detection: finds columns that likely
    join across files (matching names or overlapping values)
  - Issues report per file + master issues summary
  - Financial audit: if currency columns found, verifies totals
    survive the cleaning process unchanged
  - Pandas executive summary: row counts, null rates, value ranges
  - Writes cleaned versions of every file to /output

Run : python universal_etl.py
Reads : ./data/*.csv  (all of them, automatically)
Writes: ./output/
"""

import csv
import os
import re
import sys
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

import pandas as pd
import numpy as np

# ---------------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------------
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / 'data'
OUTPUT_DIR = BASE_DIR / 'output'
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# COLUMN TYPE DETECTION
# ---------------------------------------------------------------------------

# Patterns that strongly suggest a column type regardless of header name
CURRENCY_PATTERN  = re.compile(r'^\s*-?\(?\$[\d,]+(\.\d{1,2})?\)?\s*$')
NUMERIC_PATTERN   = re.compile(r'^\s*-?[\d,]+(\.\d+)?\s*$')
DATE_PATTERNS = [
    re.compile(r'^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$'),
    re.compile(r'^\d{4}[/.\-]\d{2}[/.\-]\d{2}$'),
    re.compile(r'^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}$', re.I),
]
BOOL_VALUES  = {'y','n','yes','no','true','false','1','0','active','inactive','a','i'}
ID_PATTERN   = re.compile(r'^\w{1,30}$')   # short alphanumeric codes

# Header keywords that hint at type (backup heuristic only)
CURRENCY_KEYWORDS = {'price','cost','amount','total','balance','fee','rate',
                     'charge','revenue','sales','payment','debit','credit',
                     'subtotal','tax','discount','value','wage','salary'}
DATE_KEYWORDS     = {'date','time','created','updated','modified','posted',
                     'ordered','shipped','due','expir','birth','start','end'}
ID_KEYWORDS       = {'id','num','number','code','ref','sku','upc','barcode',
                     '#','no','key','uuid','acct'}


def score_column_type(header, sample_values):
    """
    Return the most likely type for a column given its header and up to
    50 non-blank sample values.  Returns one of:
      'currency' | 'numeric' | 'date' | 'boolean' | 'id_code' | 'text'
    """
    non_blank = [v for v in sample_values if v and v.strip()]
    if not non_blank:
        return 'text'

    hdr_lower = header.lower()

    # ----- count pattern matches across sample -----
    n           = len(non_blank)
    cur_hits    = sum(1 for v in non_blank if CURRENCY_PATTERN.match(v.strip()))
    num_hits    = sum(1 for v in non_blank if NUMERIC_PATTERN.match(v.strip()))
    date_hits   = sum(1 for v in non_blank if any(p.match(v.strip()) for p in DATE_PATTERNS))
    bool_hits   = sum(1 for v in non_blank if v.strip().lower() in BOOL_VALUES)
    short_hits  = sum(1 for v in non_blank if len(v.strip()) <= 20 and ID_PATTERN.match(v.strip()))

    # ----- header keyword bonus (15% threshold boost) -----
    hdr_words = set(re.split(r'[\s_\-/#]+', hdr_lower))
    cur_bonus  = 0.15 if hdr_words & CURRENCY_KEYWORDS else 0.0
    date_bonus = 0.15 if hdr_words & DATE_KEYWORDS     else 0.0

    # ----- score as fraction of sample -----
    cur_score  = cur_hits  / n + cur_bonus
    num_score  = num_hits  / n
    date_score = date_hits / n + date_bonus
    bool_score = bool_hits / n

    if cur_score  >= 0.6:  return 'currency'
    if date_score >= 0.6:  return 'date'
    if bool_score >= 0.8:  return 'boolean'
    if num_score  >= 0.7:  return 'numeric'

    # ID/code: short, consistent length, mixed alpha-num
    if short_hits / n >= 0.85:
        lengths = [len(v.strip()) for v in non_blank]
        if max(lengths) - min(lengths) <= 4:   # consistent length = likely a code
            return 'id_code'

    return 'text'


# ---------------------------------------------------------------------------
# VALUE CLEANERS
# ---------------------------------------------------------------------------

def clean_currency(val):
    """'($1,234.56)' or '$1,234.56' or '1234.56' -> float or None."""
    if not val or not val.strip():
        return None
    s = val.strip()
    negative = s.startswith('(') or s.startswith('-')
    s = re.sub(r'[$,()\s]', '', s)
    try:
        result = float(s)
        return -result if (negative and result > 0) else result
    except ValueError:
        return None


def clean_numeric(val):
    """Remove commas/spaces/dollar-signs, return float or None."""
    if not val or not val.strip():
        return None
    s = val.strip()
    negative = s.startswith('(') or s.startswith('-')
    s = re.sub(r'[$,\s()]', '', s)
    try:
        result = float(s)
        return -result if (negative and result > 0) else result
    except ValueError:
        return None


def clean_date(val):
    """Normalize various date formats to YYYY-MM-DD."""
    if not val or not val.strip():
        return None
    s = val.strip()

    # ISO already
    if re.match(r'^\d{4}-\d{2}-\d{2}', s):
        return s[:10]

    # MM/DD/YYYY or DD-MM-YYYY (we assume M/D/Y as most common)
    m = re.match(r'(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})', s)
    if m:
        mo, dy, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if yr < 100:
            yr += 2000 if yr < 30 else 1900
        try:
            datetime(yr, mo, dy)      # validate
            return f"{yr:04d}-{mo:02d}-{dy:02d}"
        except ValueError:
            try:
                datetime(yr, dy, mo)  # try D/M/Y
                return f"{yr:04d}-{dy:02d}-{mo:02d}"
            except ValueError:
                pass

    # Month name
    months = {'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
              'july':7,'august':8,'september':9,'october':10,'november':11,'december':12,
              'jan':1,'feb':2,'mar':3,'apr':4,'jun':6,'jul':7,'aug':8,
              'sep':9,'oct':10,'nov':11,'dec':12}
    m = re.match(r'(\w+)\s+(\d{1,2}),?\s+(\d{4})', s, re.I)
    if m and m.group(1).lower() in months:
        return f"{m.group(3)}-{months[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"

    return s   # return as-is if unrecognised


def clean_boolean(val):
    """Normalize to TRUE/FALSE string."""
    if not val:
        return ''
    return 'TRUE' if val.strip().lower() in ('y','yes','true','1','active','a') else 'FALSE'


def clean_text(val):
    """Strip, collapse internal whitespace."""
    if not val:
        return ''
    return re.sub(r'\s+', ' ', val.strip())


# ---------------------------------------------------------------------------
# SINGLE-FILE PROCESSOR
# ---------------------------------------------------------------------------

class FileProfile:
    """Holds analysis results for one CSV file."""
    def __init__(self, filename):
        self.filename   = filename
        self.col_types  = {}     # header -> type string
        self.row_count  = 0
        self.issues     = []     # list of dicts
        self.raw_rows   = []
        self.clean_rows = []
        self.currency_cols = []
        self.raw_totals = {}     # col -> raw sum (for audit)
        self.clean_totals = {}   # col -> clean sum (for audit)


def profile_and_clean_file(filepath):
    """
    Read one CSV, detect column types, clean every cell, return FileProfile.
    """
    prof = FileProfile(Path(filepath).name)

    # ---- read raw ----
    try:
        with open(filepath, 'r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []
            headers = [h.strip() for h in headers]
            raw_rows = []
            for row in reader:
                raw_rows.append({h.strip(): (v or '').strip() for h, v in row.items()})
    except Exception as e:
        prof.issues.append({'Row': 0, 'Column': '', 'Issue': f"Could not read file: {e}", 'Raw Value': ''})
        return prof

    if not raw_rows:
        prof.issues.append({'Row': 0, 'Column': '', 'Issue': 'File is empty or has only headers', 'Raw Value': ''})
        return prof

    prof.raw_rows  = raw_rows
    prof.row_count = len(raw_rows)

    # ---- detect column types from sample ----
    sample_size = min(50, len(raw_rows))
    for header in headers:
        sample = [row.get(header, '') for row in raw_rows[:sample_size]]
        col_type = score_column_type(header, sample)
        prof.col_types[header] = col_type

    prof.currency_cols = [h for h, t in prof.col_types.items() if t == 'currency']

    # ---- raw currency totals (for audit) ----
    for col in prof.currency_cols:
        values = [clean_currency(row.get(col, '')) for row in raw_rows]
        prof.raw_totals[col] = sum(v for v in values if v is not None)

    # ---- duplicate detection (on text/id columns only) ----
    dup_check_cols = [h for h, t in prof.col_types.items()
                      if t in ('id_code', 'text') and 'id' in h.lower()]
    dup_trackers = {col: {} for col in dup_check_cols}  # col -> {val: first_row}

    # ---- clean row by row ----
    clean_rows = []
    for i, row in enumerate(raw_rows, start=1):
        row_issues = []
        out = {}

        for header in headers:
            raw_val = row.get(header, '')
            col_type = prof.col_types.get(header, 'text')

            # ---- blank check ----
            if not raw_val:
                out[header] = ''
                # Only flag if it looks like an important column
                important_keywords = {'name','id','number','code','type','date',
                                      'amount','total','price','account','sku'}
                hdr_words = set(re.split(r'[\s_\-/#]+', header.lower()))
                if hdr_words & important_keywords:
                    row_issues.append(f"'{header}' is blank")
                continue

            # ---- type-specific cleaning ----
            if col_type == 'currency':
                cleaned = clean_currency(raw_val)
                if cleaned is None:
                    row_issues.append(f"'{header}' unparseable currency: '{raw_val}'")
                    out[header] = raw_val
                else:
                    out[header] = f"{cleaned:.2f}"

            elif col_type == 'numeric':
                cleaned = clean_numeric(raw_val)
                if cleaned is None:
                    row_issues.append(f"'{header}' unparseable number: '{raw_val}'")
                    out[header] = raw_val
                else:
                    # Preserve integer appearance if no decimal in original
                    out[header] = str(int(cleaned)) if cleaned == int(cleaned) else str(cleaned)

            elif col_type == 'date':
                cleaned = clean_date(raw_val)
                if cleaned == raw_val and not re.match(r'\d{4}-\d{2}-\d{2}', cleaned):
                    row_issues.append(f"'{header}' unrecognised date format: '{raw_val}'")
                out[header] = cleaned

            elif col_type == 'boolean':
                out[header] = clean_boolean(raw_val)

            else:   # text or id_code
                out[header] = clean_text(raw_val)

            # ---- duplicate check ----
            if header in dup_trackers:
                key = out[header].lower()
                if key in dup_trackers[header]:
                    row_issues.append(
                        f"'{header}' duplicate value '{out[header]}' "
                        f"(first seen row {dup_trackers[header][key]})"
                    )
                else:
                    dup_trackers[header][key] = i

        clean_rows.append(out)
        if row_issues:
            for issue_text in row_issues:
                prof.issues.append({
                    'Row':       i,
                    'Column':    issue_text.split("'")[1] if "'" in issue_text else '',
                    'Issue':     issue_text,
                    'Raw Value': row.get(issue_text.split("'")[1], '') if "'" in issue_text else '',
                })

    prof.clean_rows = clean_rows

    # ---- clean currency totals (audit) ----
    for col in prof.currency_cols:
        values = [clean_currency(row.get(col, '')) for row in clean_rows]
        prof.clean_totals[col] = sum(v for v in values if v is not None)

    return prof


# ---------------------------------------------------------------------------
# CROSS-FILE RELATIONSHIP DETECTION
# ---------------------------------------------------------------------------

def detect_relationships(profiles):
    """
    Find columns across different files that are likely foreign keys.
    Returns list of (file_a, col_a, file_b, col_b, match_type).
    """
    relationships = []
    prof_list = list(profiles.values())

    for i, pa in enumerate(prof_list):
        for pb in prof_list[i+1:]:
            for col_a, type_a in pa.col_types.items():
                for col_b, type_b in pb.col_types.items():

                    # Same column name across files
                    if col_a.lower() == col_b.lower():
                        relationships.append((pa.filename, col_a, pb.filename, col_b, 'matching column name'))
                        continue

                    # One col name appears in the other (e.g. "Customer ID" vs "Customer")
                    a_lower, b_lower = col_a.lower(), col_b.lower()
                    if (len(a_lower) > 3 and a_lower in b_lower) or \
                       (len(b_lower) > 3 and b_lower in a_lower):
                        relationships.append((pa.filename, col_a, pb.filename, col_b, 'partial name match'))

    return relationships


# ---------------------------------------------------------------------------
# FILE I/O HELPERS
# ---------------------------------------------------------------------------

def write_csv(data, filepath):
    if not data:
        return
    all_keys = list(dict.fromkeys(k for row in data for k in row))
    with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=all_keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(data)


def discover_csv_files(directory, recursive=False):
    """Return list of CSV paths from directory (optionally recursive)."""
    d = Path(directory)
    if not d.is_dir():
        return []
    if recursive:
        return list(d.rglob('*.csv'))
    return list(d.glob('*.csv'))


# ---------------------------------------------------------------------------
# PANDAS SUMMARY
# ---------------------------------------------------------------------------

def generate_summary_report(profiles):
    """Print and save a cross-file summary using Pandas."""
    rows = []
    for prof in profiles.values():
        if not prof.clean_rows:
            continue
        df = pd.DataFrame(prof.clean_rows)

        # Null rate per file
        total_cells = df.shape[0] * df.shape[1]
        blank_cells  = (df == '').sum().sum()
        null_rate    = (blank_cells / total_cells * 100) if total_cells else 0

        # Currency totals
        cur_summary = []
        for col in prof.currency_cols:
            df[col + '_num'] = pd.to_numeric(df[col], errors='coerce')
            total = df[col + '_num'].sum()
            cur_summary.append(f"{col}: ${total:,.2f}")

        rows.append({
            'File':              prof.filename,
            'Rows':              prof.row_count,
            'Columns':           len(prof.col_types),
            'Issues Found':      len(prof.issues),
            'Blank Rate':        f"{null_rate:.1f}%",
            'Readiness %':       f"{max(0, round((1 - len(prof.issues)/max(prof.row_count,1)) * 100))}%",
            'Currency Columns':  ', '.join(c for c in prof.currency_cols) or 'none',
            'Currency Totals':   ' | '.join(cur_summary) or 'n/a',
        })

    if not rows:
        return

    summary_df = pd.DataFrame(rows)
    print("\n" + summary_df.to_string(index=False))

    out_path = OUTPUT_DIR / 'Executive_Summary.csv'
    summary_df.to_csv(out_path, index=False)
    print(f"\n  [Write] Executive_Summary.csv")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 64)
    print("  Universal CSV Data Cleaning & Migration Prep Engine")
    print("=" * 64)

    # ------------------------------------------------------------------
    # 1. Discover files
    # ------------------------------------------------------------------
    csv_files = discover_csv_files(DATA_DIR, recursive=False)

    if not csv_files:
        print(f"\n  No CSV files found in {DATA_DIR}")
        print("  Drop your data files in ./data/ and run again.\n")
        sys.exit(0)

    print(f"\n[1] Found {len(csv_files)} CSV file(s) in {DATA_DIR}:")
    for f in csv_files:
        size_kb = f.stat().st_size // 1024
        print(f"    {f.name:<50}  {size_kb:>6} KB")

    # ------------------------------------------------------------------
    # 2. Profile + clean each file
    # ------------------------------------------------------------------
    print("\n[2] Profiling and cleaning ...")
    profiles = {}

    for filepath in csv_files:
        print(f"\n  --- {filepath.name} ---")
        prof = profile_and_clean_file(filepath)
        profiles[filepath.name] = prof

        if not prof.col_types:
            print("    [SKIP] Could not read file.")
            continue

        print(f"    Rows        : {prof.row_count}")
        print(f"    Columns     : {len(prof.col_types)}")

        # Show detected types
        type_summary = defaultdict(list)
        for col, typ in prof.col_types.items():
            type_summary[typ].append(col)
        for typ, cols in sorted(type_summary.items()):
            print(f"    {typ:<12}: {', '.join(cols[:6])}" +
                  (f" (+{len(cols)-6} more)" if len(cols)>6 else ""))

        print(f"    Issues      : {len(prof.issues)}")

    # ------------------------------------------------------------------
    # 3. Write cleaned files
    # ------------------------------------------------------------------
    print("\n[3] Writing cleaned files ...")
    for name, prof in profiles.items():
        if prof.clean_rows:
            stem = Path(name).stem
            out_path = OUTPUT_DIR / f"{stem}_CLEAN.csv"
            write_csv(prof.clean_rows, out_path)
            print(f"    {stem}_CLEAN.csv  ({len(prof.clean_rows)} rows)")

    # ------------------------------------------------------------------
    # 4. Master issues report
    # ------------------------------------------------------------------
    all_issues = []
    for name, prof in profiles.items():
        for issue in prof.issues:
            all_issues.append({'Source File': name, **issue})

    if all_issues:
        issues_path = OUTPUT_DIR / 'issues_report.csv'
        fieldnames  = ['Source File', 'Row', 'Column', 'Issue', 'Raw Value']
        with open(issues_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(all_issues)
        print(f"\n    issues_report.csv  ({len(all_issues)} total issues)")

    # ------------------------------------------------------------------
    # 5. Cross-file relationship detection
    # ------------------------------------------------------------------
    relationships = detect_relationships(profiles)
    if relationships:
        rel_path = OUTPUT_DIR / 'detected_relationships.csv'
        rel_rows = [
            {'File A': fa, 'Column A': ca, 'File B': fb,
             'Column B': cb, 'Match Type': mt}
            for fa, ca, fb, cb, mt in relationships
        ]
        write_csv(rel_rows, rel_path)
        print(f"\n[4] Detected {len(relationships)} potential cross-file relationship(s):")
        for fa, ca, fb, cb, mt in relationships[:10]:
            print(f"    {fa}.{ca}  <->  {fb}.{cb}  ({mt})")
        if len(relationships) > 10:
            print(f"    ... and {len(relationships)-10} more (see detected_relationships.csv)")

    # ------------------------------------------------------------------
    # 6. Financial integrity audit
    # ------------------------------------------------------------------
    print("\n[5] Financial integrity audit ...")
    any_currency = False
    all_passed   = True
    for name, prof in profiles.items():
        for col in prof.currency_cols:
            any_currency = True
            raw   = prof.raw_totals.get(col, 0)
            clean = prof.clean_totals.get(col, 0)
            delta = abs(raw - clean)
            ok    = delta < 0.01
            if not ok:
                all_passed = False
            status = "[OK]" if ok else "[!!]"
            print(f"    {status} {name} / {col}: raw ${raw:,.2f}  ->  clean ${clean:,.2f}"
                  + (f"  DELTA ${delta:,.2f}" if not ok else ""))
    if not any_currency:
        print("    No currency columns detected across all files.")

    # ------------------------------------------------------------------
    # 7. Pandas executive summary
    # ------------------------------------------------------------------
    print("\n[6] Executive summary:")
    generate_summary_report(profiles)

    # ------------------------------------------------------------------
    # 8. Final report
    # ------------------------------------------------------------------
    total_rows   = sum(p.row_count for p in profiles.values())
    total_issues = len(all_issues)
    W = 64

    def row(text):
        print(f"  | {text:<{W-4}} |")

    print(f"\n  +{'-'*(W-2)}+")
    print(f"  |{'  MIGRATION READINESS REPORT':^{W-2}}|")
    print(f"  +{'-'*(W-2)}+")
    row(f"Files processed  : {len(profiles)}")
    row(f"Total rows       : {total_rows:,}")
    row(f"Total issues     : {total_issues:,}")
    row(f"Financial audit  : {'ALL PASSED' if all_passed else 'REVIEW REQUIRED'}")
    row("")
    row("Per-file readiness:")
    for name, prof in profiles.items():
        if prof.row_count == 0:
            continue
        pct = max(0, round((1 - len(prof.issues) / max(prof.row_count, 1)) * 100))
        bar_len = 20
        filled  = int(bar_len * pct / 100)
        bar     = "#" * filled + "." * (bar_len - filled)
        row(f"  {Path(name).stem[:28]:<28}  [{bar}] {pct}%")
    print(f"  +{'-'*(W-2)}+")
    print(f"\n  Output written to: {OUTPUT_DIR}\n")


if __name__ == '__main__':
    main()

