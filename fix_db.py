"""
fix_db.py — Copy leads from crmdb → readable_crm (correct database)
Run: python3 fix_db.py
"""
from pymongo import MongoClient

MONGO_URI = "mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"

client = MongoClient(MONGO_URI)

src  = client['crmdb']['leads']
dst  = client['readable_crm']['leads']

# Load existing in destination to avoid dupes
existing = set()
for doc in dst.find({}, {'email': 1, 'li': 1}):
    if doc.get('email'): existing.add(doc['email'].lower())
    if doc.get('li'):    existing.add(doc['li'].lower())

print(f"📋 {dst.count_documents({})} leads already in readable_crm")
print(f"📋 {src.count_documents({})} leads in crmdb to copy\n")

copied  = 0
skipped = 0

for doc in src.find({}):
    doc.pop('_id', None)
    email = (doc.get('email') or '').lower()
    li    = (doc.get('li') or '').lower()

    if email and email in existing:
        skipped += 1
        continue
    if li and li in existing:
        skipped += 1
        continue

    dst.insert_one(doc)
    if email: existing.add(email)
    if li:    existing.add(li)
    copied += 1
    print(f"  ✓ {doc.get('name')} | {doc.get('co')}")

client.close()
print(f"\n✅ Done — {copied} leads copied, {skipped} duplicates skipped")
print("🎉 Refresh your CRM admin panel — all leads are now live!")
