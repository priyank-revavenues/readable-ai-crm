"""
pull_and_sync.py — RocketReach → MongoDB Atlas (direct sync)
=============================================================
Pulls Readable.ai ICP leads from RocketReach and inserts them
directly into MongoDB Atlas. Also saves a CSV backup.

HOW TO RUN:
  pip3 install requests pymongo --break-system-packages
  python3 pull_and_sync.py
"""

import requests
import csv
import time
import os
from datetime import datetime
from pymongo import MongoClient

# ── CONFIG ──────────────────────────────────────────────────────────────
RR_API_KEY   = "154fad3kf194e85c7b4da99471e039868bf33e14"
MONGO_URI    = "mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
DB_NAME      = "crmdb"
OUTPUT_CSV   = "rocketreach_leads_backup.csv"

PAGE_SIZE    = 10
MAX_LEADS    = 100
PAUSE_SEC    = 1.5

SEARCH_URL   = "https://api.rocketreach.co/api/v2/search"
LOOKUP_URL   = "https://api.rocketreach.co/api/v2/person/lookup"

HEADERS = {
    "Api-Key": RR_API_KEY,
    "Content-Type": "application/json"
}

ICP_INDUSTRIES = [
    "Financial Services", "Banking", "Insurance", "Fintech",
    "Information Technology", "Computer Software", "Internet",
    "Retail", "Consumer Goods", "E-Commerce",
    "Healthcare", "Manufacturing", "Pharmaceuticals",
]
ICP_LOCATIONS   = ["India"]
EMPLOYEE_RANGES = ["201-500", "501-1000", "1001-5000"]

TITLE_BATCHES = [
    {
        "label": "CMO / Head of Marketing",
        "titles": ["Chief Marketing Officer", "CMO", "Head of Marketing", "VP Marketing", "VP of Marketing"]
    },
    {
        "label": "Head of Digital Marketing",
        "titles": ["Head of Digital Marketing", "Head of Digital", "Director of Digital Marketing", "Chief Digital Officer", "CDO"]
    },
    {
        "label": "Innovation / AI Head",
        "titles": ["Head of Innovation", "Innovation Head", "AI Implementation Head", "Head of AI", "Head of Growth", "Growth Head"]
    },
    {
        "label": "Founder / CEO",
        "titles": ["Founder", "Co-Founder", "CEO", "Chief Executive Officer"]
    },
]

# ── HELPERS ──────────────────────────────────────────────────────────────

def clean(val):
    return str(val).strip() if val else ""

def map_industry(raw):
    m = {
        "financial services": "BFSI / Fintech", "banking": "BFSI / Fintech",
        "insurance": "BFSI / Fintech", "fintech": "BFSI / Fintech",
        "information technology": "IT / SaaS", "computer software": "IT / SaaS", "internet": "IT / SaaS",
        "retail": "Retail / D2C", "consumer goods": "Retail / D2C", "e-commerce": "Retail / D2C",
        "healthcare": "Healthcare", "pharmaceuticals": "Healthcare",
        "manufacturing": "Manufacturing",
    }
    return m.get((raw or "").lower(), "Other")

def score_lead(profile):
    score = 3
    title = clean(profile.get("current_title", "")).lower()
    employees = profile.get("current_employer_employees", 0) or 0
    if any(t in title for t in ["cmo", "chief marketing", "head of marketing", "chief digital"]): score += 1
    if any(t in title for t in ["founder", "ceo", "chief executive"]): score += 1
    if any(t in title for t in ["innovation", "ai implementation", "head of ai"]): score += 0.5
    if 500 <= employees <= 2000: score += 0.5
    elif employees < 200: score -= 1
    return min(5, max(1, round(score)))

def search_people(titles, start=1):
    payload = {
        "query": {
            "current_title": titles,
            "current_employer": [],
            "location": ICP_LOCATIONS,
            "employees": EMPLOYEE_RANGES,
            "industry": ICP_INDUSTRIES,
        },
        "start": start,
        "pageSize": PAGE_SIZE,
    }
    try:
        r = requests.post(SEARCH_URL, headers=HEADERS, json=payload, timeout=15)
        r.raise_for_status()
        return r.json().get("profiles", [])
    except requests.exceptions.HTTPError as e:
        print(f"  ⚠️  HTTP {e.response.status_code}: {e.response.text[:200]}")
        return []
    except Exception as e:
        print(f"  ⚠️  Error: {e}")
        return []

def get_emails_phones(profile_id, li_url=""):
    try:
        params = {"id": profile_id}
        if li_url: params["li_url"] = li_url
        r = requests.get(LOOKUP_URL, headers=HEADERS, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        emails = [e.get("email","") for e in data.get("emails",[]) if e.get("email")]
        phones = [p.get("number","") for p in data.get("phones",[]) if p.get("number")]
        return emails[0] if emails else "", phones[0] if phones else ""
    except:
        return "", ""

# ── MAIN ─────────────────────────────────────────────────────────────────

def main():
    print("\n" + "="*64)
    print("  RocketReach → MongoDB Sync — Readable.ai ICP")
    print("="*64)

    # Connect to MongoDB
    print("🔗 Connecting to MongoDB Atlas...")
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    leads_col = db["leads"]
    print("✅ Connected!\n")

    # Load existing emails from MongoDB for dedup
    existing_emails = set()
    existing_li = set()
    for doc in leads_col.find({}, {"email": 1, "li": 1}):
        if doc.get("email"): existing_emails.add(doc["email"].lower())
        if doc.get("li"): existing_li.add(doc["li"].lower())
    print(f"📋 {len(existing_emails)} leads already in MongoDB (will skip duplicates)\n")

    all_leads   = []
    seen_ids    = set()
    skipped     = 0
    per_batch   = MAX_LEADS // len(TITLE_BATCHES)
    next_id     = leads_col.count_documents({}) + 11  # start after existing IDs

    for batch in TITLE_BATCHES:
        label  = batch["label"]
        titles = batch["titles"]
        pulled = 0
        start  = 1
        print(f"🔍 Pulling: {label} (target {per_batch} leads)")

        while pulled < per_batch:
            profiles = search_people(titles, start=start)
            if not profiles:
                print(f"   No more results.")
                break

            for p in profiles:
                pid = p.get("id") or p.get("linkedin_url", "")
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)

                # Extract email
                email = ""
                if p.get("emails") and isinstance(p["emails"], list):
                    email = p["emails"][0].get("email", "")

                li_url = clean(p.get("linkedin_url", ""))

                # Dedup check
                if email and email.lower() in existing_emails:
                    skipped += 1
                    continue
                if li_url and li_url.lower() in existing_li:
                    skipped += 1
                    continue

                # Fetch email if missing
                if not email and p.get("id"):
                    time.sleep(0.5)
                    email, phone_lookup = get_emails_phones(p["id"], li_url)
                else:
                    phone_lookup = ""

                phone = ""
                if p.get("phones") and isinstance(p["phones"], list):
                    phone = p["phones"][0].get("number", "")
                if not phone:
                    phone = phone_lookup

                name     = clean(p.get("name", ""))
                company  = clean(p.get("current_employer", ""))
                title    = clean(p.get("current_title", ""))
                industry = map_industry(p.get("current_employer_industry", ""))
                city     = clean(p.get("location", ""))
                employees = p.get("current_employer_employees", "")
                score    = score_lead(p)
                today    = datetime.now().strftime("%Y-%m-%d")

                lead_doc = {
                    "id":    next_id,
                    "name":  name,
                    "co":    company,
                    "desg":  title,
                    "ind":   industry,
                    "email": email,
                    "phone": phone,
                    "li":    li_url,
                    "src":   "RocketReach",
                    "stage": "Identified",
                    "lc":    "",
                    "nc":    "",
                    "owner": "",
                    "notes": f"RocketReach · {label} · Score {score}/5 · {city}",
                    "city":  city,
                    "employees": str(employees),
                    "score": score,
                    "persona": label,
                    "imported": today,
                }

                # Insert into MongoDB
                leads_col.insert_one(lead_doc)
                next_id += 1

                # Track for dedup
                if email: existing_emails.add(email.lower())
                if li_url: existing_li.add(li_url.lower())

                all_leads.append(lead_doc)
                pulled += 1

                status = "✓" if email else "○"
                print(f"   {status} {name} | {company} | {title[:35]}")

                if pulled >= per_batch:
                    break

            start += PAGE_SIZE
            time.sleep(PAUSE_SEC)

        print(f"  → {pulled} leads added for {label}\n")

    client.close()

    if not all_leads:
        print("⚠️  No new leads found — all may be duplicates already in MongoDB.")
        return

    # Save CSV backup
    fieldnames = ["id","name","co","desg","ind","email","phone","li","src","stage","city","employees","score","persona","notes","imported"]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_leads)

    with_email = sum(1 for l in all_leads if l["email"])
    high_score = sum(1 for l in all_leads if l["score"] >= 4)

    print("="*64)
    print(f"  ✅ DONE — {len(all_leads)} leads added to MongoDB Atlas")
    if skipped: print(f"  🔁 {skipped} duplicates skipped")
    print(f"  📧 With email:    {with_email} / {len(all_leads)}")
    print(f"  ⭐ High ICP (4+): {high_score} / {len(all_leads)}")
    print(f"  💾 CSV backup:    {OUTPUT_CSV}")
    print("="*64)
    print("\n  🎉 Refresh your CRM admin panel — leads are live!\n")

if __name__ == "__main__":
    main()
